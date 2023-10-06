/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/error',
    './AMY MR Fulfillment Response Common'
], function(record, search, runtime, error, common) {
    const FulfillmentStatus = {
        Pending: 1,
        Fulfilling: 2,
        Fulfilled: 3,
        Billing: 4,
        Billed: 5,
        Canceled: 6,
        Error: 7,
        UnderInvestigation: 8,
        Transferring: 9,
        Transferred: 10,
        InTransit: 11
    };

    function getInputData() {
        return {
            type: "search",
            id: "customsearch_acb_pending_shipment_advice",
        };
    }

    function map(context) {
        try {
            // get search results and related data
            log.debug("map context", context);
            log.audit("script parameters", getScriptConfiguration());
            var searchResult = JSON.parse(context.value);
            searchResult.orderType =
                searchResult.values["custbody_cb_order_type.CUSTRECORD_ASN_ORDER"].text;
            var context = common.map(searchResult);
            if (common.orderCanBeFulfilled(context)) {
                updatecontext(context.id, {
                    custrecord_asn_status: FulfillmentStatus.Fulfilling,
                });
                fulfillOrder(context);
                // set ACB ASN link on Sales Order record
                record.submitFields({
                    type: "salesorder",
                    id: context.order,
                    values: {
                        custbody_acb_asn: context.id,
                    },
                });
                updatecontext(context.id, {
                    custrecord_asn_status: FulfillmentStatus.Fulfilled,
                    custrecord_asn_fulfillment: context.fulfillment,
                    custrecord_asn_asn_ready_to_transmit: true,
                });
                // to pass to next step
                context.status = FulfillmentStatus.Fulfilled;
                context.orderStatus = common.getOrderStatus(context);
            }
            if (common.orderCanBeBilled(context)) {
                updatecontext(context.id, {
                    custrecord_asn_status: FulfillmentStatus.Billing,
                });
                // start with invoice = fulfillment
                if (!context.orderLineQuantities) {
                    log.debug("getting fulfillment orderline data");
                    context.fulfillment = record.load({
                        type: "itemfulfillment",
                        id: context.fulfillment,
                    });
                    context.orderLineQuantities = {};
                    for (
                        var i = 0; i < context.fulfillment.getLineCount({
                            sublistId: "item"
                        });
                        ++i
                    ) {
                        var orderLine = context.fulfillment.getSublistValue({
                            sublistId: "item",
                            line: i,
                            fieldId: "orderline",
                        });
                        var quantity = context.fulfillment.getSublistValue({
                            sublistId: "item",
                            line: i,
                            fieldId: "quantity",
                        });
                        context.orderLineQuantities[orderLine] = quantity;
                    }
                }
                billOrder(context);
                // link ACB ASN on Sales Order record
                record.submitFields({
                    type: "salesorder",
                    id: context.order,
                    values: {
                        custbody_acb_asn: context.id,
                    },
                });
                // set status = Billed
                updatecontext(context.id, {
                    custrecord_asn_status: FulfillmentStatus.Billed,
                    custrecord_asn_invoice: context.billingTransaction,
                    custrecord_asn_invoice_ready_to_transmit: true,
                });
                context.invoice = context.billingTransaction;
            }
            if (common.orderCanBeEmailed(context)) {
                try {
                    common.emailInvoice(context.invoice, getScriptConfiguration());
                    updatecontext(context.id, {
                        custrecord_asn_invoice_transmitted: true,
                        custrecord_asn_status: FulfillmentStatus.Billed,
                    });
                } catch (e) {
                    updatecontext(context.id, {
                        custrecord_asn_status: FulfillmentStatus.Error,
                        custrecord_asn_invoice_error: true,
                        custrecord_asn_error_message: e.toString(),
                    });
                }
            }
            if (common.orderCanBeTransferred(context)) {
                log.debug("context to transfer", context);
                updatecontext(context.id, {
                    custrecord_asn_status: FulfillmentStatus.Transferring,
                });
                log.debug("order transferring . . ");
                // create the Inventory Transfer
                transferOrder(context);
                // update the ASN with Transfer transaction id and status 'Transferred'
                updatecontext(context.id, {
                    custrecord_asn_status: FulfillmentStatus.Transferred,
                });
                // update sales order location to FOB Destination
                // custbody_amy_transfer_for_order
                record.submitFields({
                    type: "salesorder",
                    id: context.order,
                    values: {
                        custbody_amy_transfer_for_order: context.transfer,
                        location: context.fobTransferLocation,
                        custbody_acb_asn: context.id,
                    },
                });
                // set ASN Ready to Transmit
                // Set Status to 'In-Transit'
                updatecontext(context.id, {
                    custrecord_asn_status: FulfillmentStatus.InTransit,
                    custrecord_asn_asn_ready_to_transmit: true,
                    custrecord_asn_in_transit_transfer: context.transfer,
                });
            }
        } catch (e) {
            log.error("map failed", e);
            updatecontext(context.id, {
                custrecord_asn_status: FulfillmentStatus.Error,
                custrecord_asn_error_message: e.toString(),
            });
        }
    }

    function matchAsnLinesToOrderLines(context, transaction) {
        var orderLineQuantities = {};
        // sum ASN line quantities to SKU totals
        var items = context.lines;
        log.debug('context.lines', items);
        // save off store number to use for the item if its in the ASN;
        var asnDCNumber = context.ship_to_dc || 'NONE'
        var quantities = {};
        for (var i = 0; i < items.length; ++i) {
            var sku = items[i].sku;
            var store = items[i].store_number;
            var key = `${sku}-${store}`;
            quantities[key] = (parseInt(quantities[key]) || 0) + items[i].quantity;
        }
        // first line index for each item, to apply extra quantities
        var itemFirstLines = {};
        log.debug('transaction', transaction);
        // traverse item list and apply shippable quantity from ASN
        for (var i = 0; i < transaction.getLineCount({
                sublistId: "item"
            }); ++i) {
            var sku = transaction.getSublistValue({
                sublistId: "item",
                line: i,
                fieldId: "itemname",
            });
            var orderLine = transaction.getSublistValue({
                sublistId: "item",
                line: i,
                fieldId: "orderline",
            });
            var fulfillmentStoreNumber = transaction.getSublistValue({
                sublistId: "item",
                line: i,
                fieldId: "custcol_amyris_store_numberdisp", // store number on the order record (DC?)
            });
            
            log.debug('salesOrderStoreNumber: custcol_amyris_store_numberdisp', fulfillmentStoreNumber);
            log.debug('asnDCNumber: custrecord_asn_ship_to_dc', asnDCNumber);
            // The Store Number for the Item should take precedence over the DC, 
            // because it can differ by item.
            var storeNumber = fulfillmentStoreNumber || asnDCNumber;
            // The store number is used as part of the key because multiple SKUs 
            // may exist in the package payload.
            var lookupKey = `${sku}-${storeNumber}`;
            // TODO: what is this for an invoice?
            var quantityRemaining = parseInt(transaction.getSublistValue({
                sublistId: "item",
                line: i,
                fieldId: "quantityremaining",
            })) || 0;
            log.debug("line to ship", {
                sku: sku,
                quantity: quantityRemaining,
                line: i,
                storeNumber: storeNumber
            });
            // in case of extra quantity, we will refer back to the first appearance of the SKU
            // and add the quantity there
            itemFirstLines[lookupKey] =
                itemFirstLines[lookupKey] == undefined ? orderLine : itemFirstLines[lookupKey];
            log.debug("itemFirstLines", itemFirstLines);
            if (quantityRemaining > 0) {
                log.debug("quantityRemaning", quantityRemaining);
                if (quantities[lookupKey] > 0) {
                    log.debug("quantities", quantities[lookupKey]);
                    log.debug("check", {
                        quantityRemaining: quantityRemaining,
                        quantities: quantities[lookupKey],
                        orderLineQuantities: orderLineQuantities,
                        i: i,
                    });
                    // clamp ship quantity to fulfillment response for partial shipment
                    if (quantityRemaining > quantities[lookupKey]) {
                        quantityRemaining = quantities[lookupKey];
                    }
                    orderLineQuantities[orderLine] = quantityRemaining;
                    // remove shipped quantity from fulfillment response total in case this line appears later in the order
                    quantities[lookupKey] -= quantityRemaining;
                } else {
                    // did not have any stock for this line
                    log.debug("item not shipped", sku);
                }
            }
            log.debug("line complete");
        }
        log.debug("remaining quantities", quantities);
        // find any remaining quantities which exceeded order amounts and apply to the first appearances of those SKUs
        for (var key in quantities) {
            if (quantities[key] > 0) {
                log.debug("adding extra quantity", {
                    key: key,
                    quantity: quantities[key],
                    line: itemFirstLines[key],
                });
                if (itemFirstLines[key] != undefined) {
                    // add extra quantity to first appearance of the SKU in the fulfillment
                    orderLineQuantities[itemFirstLines[key]] += quantities[key];
                } else {
                    // don't have a line for this item at all
                    log.debug("No Line for sku", key);
                    throw error.create({
                        name: "shipment data error",
                        message: "ASN contains item(s) not on the order",
                    });
                }
            }
        }
        context.orderLineQuantities = orderLineQuantities;
    }

    function addressFieldEquals(address, field, value) {
        var addressValue = address.getValue({
            fieldId: field
        });
        return (addressValue || "").toUpperCase() == (value || "").toUpperCase();
    }

    function addressesAreEqual(context, transaction) {
        var address = transaction.getSubrecord({
            fieldId: "shippingaddress"
        });
        return (
            addressFieldEquals(address, "attention", context.ship_to_name) &&
            addressFieldEquals(address, "addr1", context.ship_to_address1) &&
            addressFieldEquals(address, "addr2", context.ship_to_address2) &&
            addressFieldEquals(address, "city", context.ship_to_city) &&
            addressFieldEquals(address, "state", context.ship_to_state) &&
            addressFieldEquals(address, "zip", context.ship_to_zip) &&
            addressFieldEquals(address, "country", context.ship_to_country) &&
            addressFieldEquals(
                address,
                "custrecord_cb_addr_store_number",
                context.ship_to_dc
            )
        );
    }

    function fulfillOrder(context) {
        var fulfilling = false;
        log.debug("fulfillOrder context", context);
        log.debug('transaction date', context.transactionDate);
        log.debug('ship date', context.shipDate);
        var fulfillment = record.transform({
            fromType: "salesorder",
            fromId: context.order,
            toType: "itemfulfillment",
        });
        var currentDate = new Date(); // get current date
        //currentDate = convertDateFormat(currentDate); // convert date format to mm/dd/yyyyy
        log.debug('fulfillOrder - currentDate: ' + currentDate);
        // header fields
        fulfillment.setValue({
            fieldId: "trandate",
            value: currentDate
        }); // original value context.transactionDate
        fulfillment.setValue({
            fieldId: "custbody_cb_3pl_ship_date",
            value: context.shipDate
        });
        fulfillment.setValue({
            fieldId: "custbody_acb_asn",
            value: context.id
        });
        fulfillment.setValue({
            fieldId: "custbody7",
            value: context.carrier
        });
        fulfillment.setValue({
            fieldId: "custbody_acb_store_number",
            value: context.ship_to_store
        });
        fulfillment.setValue({
            fieldId: "custbody_acb_dc_number",
            value: context.ship_to_dc
        });
        fulfillment.setValue({
            fieldId: "shipstatus",
            value: "C"
        });
        if (addressesAreEqual(context, fulfillment)) {
            log.debug("address matched");
        } else {
            log.debug("address mismatched");
            fulfillment.setValue({
                fieldId: "shipaddress",
                value: ""
            });
            var address = fulfillment.getSubrecord({
                fieldId: "shippingaddress"
            });
            address.setValue({
                fieldId: "attention",
                value: context.ship_to_name
            });
            address.setValue({
                fieldId: "addressee",
                value: ""
            });
            address.setValue({
                fieldId: "custrecord_cb_addr_store_number",
                value: context.ship_to_dc || context.ship_to_store
            });
            address.setValue({
                fieldId: "addr0",
                value: context.ship_to_address1
            });
            address.setValue({
                fieldId: "addr1",
                value: context.ship_to_address2
            });
            address.setValue({
                fieldId: "city",
                value: context.ship_to_city
            });
            address.setValue({
                fieldId: "state",
                value: context.ship_to_state
            });
            address.setValue({
                fieldId: "zip",
                value: context.ship_to_zip
            });
            address.setValue({
                fieldId: "country",
                value: context.ship_to_country
            });
        }
        matchAsnLinesToOrderLines(context, fulfillment);
        //log.debug("context.orderLineQuantities", context.orderLineQuantities);
        for (var i = -1; i < fulfillment.getLineCount({
                sublistId: "item"
            }); ++i) {
            var orderLine = fulfillment.getSublistValue({
                sublistId: "item",
                line: i,
                fieldId: "orderline",
            });
            if (context.orderLineQuantities[orderLine]) {
                fulfillment.setSublistValue({
                    sublistId: "item",
                    line: i,
                    fieldId: "itemreceive",
                    value: true
                });
                fulfillment.setSublistValue({
                    sublistId: "item",
                    line: i,
                    fieldId: "quantity",
                    value: context.orderLineQuantities[orderLine]
                });
                fulfilling = true;
            }
        }
        log.debug("fulfilling any item", fulfilling);
        log.debug("fulfilling to save:", fulfillment);
        if (fulfilling) {
            context.fulfillment = fulfillment.save();
            record.submitFields({
                type: "salesorder",
                id: context.order,
                values: {
                    custbody_cb_3pl_ship_date_so: context.shipDate,
                },
            });
        } else {
            throw error.create({
                name: "shipment data error",
                message: "some item quantities in the order cannot be fulfilled",
            });
        }
    }

    function closeOrder(id) {
        var order = record.load({
            type: "salesorder",
            id: id,
        });
        for (var i = 0; i < order.getLineCount({
                sublistId: "item"
            }); ++i) {
            if (
                order.getSublistValue({
                    sublistId: "item",
                    line: i,
                    fieldId: "itemtype",
                }) != "EndGroup"
            ) {
                order.setSublistValue({
                    sublistId: "item",
                    line: i,
                    fieldId: "isclosed",
                    value: true,
                });
            }
        }
        order.save();
    }

    function transferOrder(context) {
        log.debug("transferOrder context", context);
        var orderFields = common.getTransferOrderInfo(context.order);
        var transferring = false;
        var asnItems = common.getASNItemDetails(context.id);
        log.debug("asnItems", asnItems);
        var fobTransferLocation = common.getFOBLocation(
            orderFields.subsidiary[0].value,
            context
        );
        // get SKUs from ASN
        let skus = [];
        let asnKeys = Object.keys(asnItems);
        asnKeys.forEach((key, i) => {
            skus.push(key)
        })
        var filters = [];
        for (let i = 0; i < skus.length; ++i) {
            filters.push(["itemid", "is", skus[i]]);
            filters.push("or");
        }
        filters.pop();
        var itemInternalIds = getItemInternalIds(filters);
        var transferRecord = record
            .create({
                type: record.Type.INVENTORY_TRANSFER,
            })
            .setValue({
                fieldId: "custbody_amy_transfer_for_order",
                value: context.order,
            })
            .setValue({
                fieldId: "trandate",
                value: context.shipDate
            })
            .setValue({
                fieldId: "custbody_acb_asn",
                value: context.id,
            })
            .setValue({
                fieldId: "department",
                value: orderFields.department[0].value,
            })
            .setValue({
                fieldId: "class",
                value: orderFields.class[0].value,
            })
            .setValue({
                fieldId: "subsidiary",
                value: orderFields.subsidiary[0].value,
            })
            .setValue({
                fieldId: "location",
                value: orderFields.location[0].value,
            })
            .setValue({
                fieldId: "transferlocation",
                value: context.fobTransferLocation,
            });
        for (var key of Object.keys(asnItems)) {
            transferRecord.insertLine({
                sublistId: "inventory",
                line: 0,
            });
            transferRecord.setSublistValue({
                sublistId: "inventory",
                fieldId: "item",
                line: 0,
                value: itemInternalIds[key],
            });
            transferRecord.setSublistValue({
                sublistId: "inventory",
                fieldId: "adjustqtyby",
                line: 0,
                value: asnItems[key].quantityadjustment,
            });
            transferring = true;
        }
        if (transferring) {
            context.transfer = transferRecord.save();
        } else {
            throw error.create({
                name: "inventory transfer data error",
                message: "could not create inventory transfer",
            });
        }
    }

    function getItemInternalIds(filters) {
        var itemsByItemId = {};
        search
            .create({
                type: "item",
                filters: filters,
                columns: ["itemid"],
            })
            .run()
            .each(function(result) {
                itemsByItemId[result.getValue("itemid")] = result.id;
                return true;
            });
        return itemsByItemId;
    }

    function billOrder(context) {
        var billOrder;
        var limitBillingToOrder;
        if (
            (context.orderType == "Resend" || context.orderType == "ShipRequest") &&
            context.orderStatus == "Pending Billing"
        ) {
            // if Resend or ShipRequest, close order if completely fulfilled
            log.debug("Resend/ShipRequest complete - closing order");
            closeOrder(context.order);
            billOrder = false;
        } else {
            // all other order types get billed
            var billingType = context.paymentMethod ? "cashsale" : "invoice";
            var billingTransaction = record.transform({
                fromType: "salesorder",
                fromId: context.order,
                toType: billingType,
            });
            billingTransaction.setValue({
                fieldId: "trandate",
                value: context.transactionDate,
            });
            billingTransaction.setValue({
                fieldId: "custbody_acb_asn",
                value: context.id,
            });
            for (
                var i = billingTransaction.getLineCount({
                    sublistId: "item"
                }); i >= 0;
                --i
            ) {
                var orderLine = billingTransaction.getSublistValue({
                    sublistId: "item",
                    line: i,
                    fieldId: "orderline",
                });
                if (context.orderLineQuantities[orderLine]) {
                    billingTransaction.setSublistValue({
                        sublistId: "item",
                        line: i,
                        fieldId: "quantity",
                        value: context.orderLineQuantities[orderLine],
                    });
                } else {
                    billingTransaction.removeLine({
                        sublistId: "item",
                        line: i
                    });
                }
            }
            if (context.orderType == "B2C" || context.orderType == "INTL") {
                // if B2C or INTL order, bill mininum of ordered and fulfilled quantity (override NetSuite standard logic for overfulfillments)
                limitBillingToOrder = common.getOrderLineDetails(context.order);
                for (
                    var i = 0; i < billingTransaction.getLineCount({
                        sublistId: "item"
                    });
                    ++i
                ) {
                    if (
                        billingTransaction.getSublistValue({
                            sublistId: "item",
                            line: i,
                            fieldId: "itemtype",
                        }) != "EndGroup"
                    ) {
                        var orderLineDetails =
                            limitBillingToOrder[
                                billingTransaction.getSublistValue({
                                    sublistId: "item",
                                    line: i,
                                    fieldId: "orderline",
                                })
                            ];
                        // shipped more than ordered?
                        if (orderLineDetails.quantityshiprecv > orderLineDetails.quantity) {
                            // bill remaining ordered quantity
                            billingTransaction.setSublistValue({
                                sublistId: "item",
                                line: i,
                                fieldId: "quantity",
                                value: orderLineDetails.quantity - orderLineDetails.quantitybilled,
                            });
                            // update extended price
                            // not necessary for NetSuite, but in case discount prorating needs to happen
                            billingTransaction.setSublistValue({
                                sublistId: "item",
                                line: i,
                                fieldId: "amount",
                                value: billingTransaction.getSublistValue({
                                        sublistId: "item",
                                        line: i,
                                        fieldId: "quantity",
                                    }) *
                                    billingTransaction.getSublistValue({
                                        sublistId: "item",
                                        line: i,
                                        fieldId: "rate",
                                    }),
                            });
                        }
                    }
                }
            }
            context.billingTransaction = billingTransaction.save();
        }
    }

    function getScriptConfiguration() {
        var scriptObj = runtime.getCurrentScript();
        return {
            senderId: scriptObj.getParameter({
                name: "custscript_amy_sa_email_sender",
            }),
            templateId: parseInt(
                scriptObj.getParameter({
                    name: "custscript_amy_sa_invoice_template"
                })
            ),
            ccAddress: scriptObj.getParameter({
                name: "custscript_amy_sa_carbon_copy",
            }),
        };
    }

    function updatecontext(id, values) {
        if (id) {
            // assume good things have happened
            values.custrecord_asn_failure_count =
                values.custrecord_asn_failure_count || 0;
            values.custrecord_asn_error_message =
                values.custrecord_asn_error_message || "";
            record.submitFields({
                type: "customrecord_acb_advance_shipping_notice",
                id: id,
                values: values,
            });
        } else {
            log.error(
                "cannot update fulfillment response status: fResId not set",
                values
            );
        }
    }
    return {
        getInputData: getInputData,
        map: map,
    };
});