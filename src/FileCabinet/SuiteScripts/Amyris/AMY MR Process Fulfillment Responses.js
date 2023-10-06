/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
 define(['N/record', 'N/search',  'N/runtime', 'N/error',
 './AMY MR Fulfillment Response Common', 'N/format'], function(record, search, runtime, error, common, format) {
	var _this = {};

	const FulfillmentStatus = {
		Pending: 1,
		Fulfilling: 2,
		Fulfilled: 3,
		Billing: 4,
		Billed: 5,
		Canceled: 6,
		Error: 7,
		Transferring: 9,
		Transferred: 10,
		InTransit: 11,
	};

	function getInputData() {
		log.audit('script parameters', getScriptConfiguration());

		return {
			type: 'search',
			id: 'customsearch_amy_pending_fres'
		};
	}

	function map(context) {
		try {
			// get search results and related data
			log.debug('map context', context);

			var searchResult = JSON.parse(context.value);
			log.debug('searchResult', searchResult);

			var fulfillmentResponse = common.map(searchResult);

			context.write(fulfillmentResponse.order, fulfillmentResponse);
		}
		catch (e) {
			log.error('fulfillment response process failed', e);

			updateContext(fulfillmentResponse.id, {
				custrecord_afr_status: FulfillmentStatus.Error,
				custrecord_afr_failure_count: ++fulfillmentResponse.failureCount,
				custrecord_afr_error_message: e.toString()
			});
		}
	}

	function reduce(context) {
		log.audit('reduce', context);

		var fulfillmentResponse = context.values;

		// Item fulfillment creation happens here for ALL the shipments per order, then save
		fulfillmentResponse.forEach(function(fulfillment, index) {
			try {
				var fulfillData = JSON.parse(fulfillment);

				if (common.orderCanBeFulfilled(fulfillData)) {
					updateContext(fulfillData.id, {
						custrecord_afr_status: FulfillmentStatus.Fulfilling,
					});

					fulfillOrder(fulfillData);
					log.debug('fulfillOrder(fulfillData)', fulfillData);
					updateContext(fulfillData.id, {
						custrecord_afr_status: FulfillmentStatus.Fulfilled,
						custrecord_afr_fulfillment: fulfillData.fulfillment,
					});
					fulfillData.status = FulfillmentStatus.Fulfilled;
					fulfillData.orderStatus = common.getOrderStatus(fulfillData);

					// Changing status in original
					fulfillmentResponse[index] = JSON.stringify(fulfillData);
				}

			} catch (e) {
				// This only happens when 3PL ship date update call fails. Set the message status to "Fulfilled" and try again
				if (fulfillData.status == FulfillmentStatus.Fulfilled) {
					log.debug(e.name, e);
					updateContext(fulfillData.id, {
						custrecord_afr_status: FulfillmentStatus.Fulfilled,
						custrecord_afr_fulfillment: fulfillData.fulfillment,
						custrecord_afr_error_message: e.toString()
					});
					update3plShipDate(fulfillData);
				}
				else {
					log.error(e.name, e);
					updateContext(fulfillData.id, {
						custrecord_afr_status: FulfillmentStatus.Error,
						custrecord_afr_failure_count: ++fulfillData.failureCount,
						custrecord_afr_error_message: e.toString()
					});	
				}
			}
		});

		// Invoice creation happens here only ONCE per fulfillment response batch execution. At the time the execution is hitting here, the current order should have a list of Item fulfillments ready
		fulfillmentResponse.forEach(function(fulfillment, index){
			try {
				var fulfillmentObj = JSON.parse(fulfillment);

				fulfillmentObj.orderStatus = common.getOrderStatus(fulfillmentObj);

				if (common.orderCanBeBilled(fulfillmentObj)) {
					updateContext(fulfillmentObj.id, {
						custrecord_afr_status: FulfillmentStatus.Billing,
					});

					billOrder(fulfillmentObj);

					// set status = Billed
					updateContext(fulfillmentObj.id, {
						custrecord_afr_status: FulfillmentStatus.Billed,
						custrecord_afr_billing_transaction: fulfillmentObj.billingTransaction,
					});

					if (fulfillmentObj.orderType == 'B2B' && !fulfillmentObj.edi) {
						common.emailInvoice(fulfillmentObj.billingTransaction,
								getScriptConfiguration());
					}
				}
				else if (common.orderCanBeClosed(fulfillmentObj)) {
                    // For split shipment handling (NET-1244). Simply mark it as Billed
                    updateContext(fulfillmentObj.id, {
                        custrecord_afr_status: FulfillmentStatus.Billed
                    });
                }
			} catch (e) {
				log.debug(e.name, e);
				updateContext(fulfillmentObj.id, {
					custrecord_afr_status: FulfillmentStatus.Error,
					custrecord_afr_failure_count: ++fulfillmentObj.failureCount,
					custrecord_afr_error_message: e.toString()
				});
			}
		});
	}

	function fulfillOrder(fulfillmentResponse) {
		log.debug('fulfillOrder context', fulfillmentResponse);

		var fulfillment = record.transform({
			fromType: (fulfillmentResponse.orderType === 'transferorder') ? 'transferorder' : 'salesorder',
			fromId: fulfillmentResponse.order,
			toType: 'itemfulfillment'
		});

		// header fields
		//fulfillment.setValue({ fieldId: 'trandate', value: format.parse({value: new Date(fulfillmentResponse.transactionDate), type: format.Type.DATE}) });
		var currentDate = new Date(); // get current date
		fulfillment.setValue({ fieldId: 'trandate', value: currentDate });	// new line added
		fulfillment.setValue({ fieldId: 'custbody_cb_3pl_ship_date', value: format.parse({value: new Date(fulfillmentResponse.shipDate), type: format.Type.DATE}) });

		fulfillment.setValue({ fieldId: 'shipstatus', value: 'C'});
		fulfillment.setValue({ fieldId: 'custbody7', value: fulfillmentResponse.message.carrier });

		// add a package for the tracking number
        if (common.isQuietLogisticsLocation(fulfillmentResponse.location) || common.isPFSLocation(fulfillmentResponse.location)){
			if (fulfillmentResponse.message.carrier_tracking_number) {
				let cartons = fulfillmentResponse.message.carrier_tracking_number.split(',');
				cartons.forEach((val, line) => {
					// [0]: carrier, [1]: tracking number, [2]: service level, [3]: carton id, [4]: weight (lb), [5]: freight cost, [6] sku + quantity
					let carton = val.split(':');
					log.debug({carton});
	
					fulfillment.insertLine({ sublistId: 'package', line });

					let weight = Number(carton[4]) == 0 ? 1: Number(carton[4]); // 0 weight causes error
					fulfillment.setSublistValue({ sublistId: 'package', line, fieldId: 'packageweight', value: weight });
					fulfillment.setSublistValue({ sublistId: 'package', line, fieldId: 'packagetrackingnumber', value: carton[1] });	
		
					let description = `Carrier: ${carton[0]}<br>Service Level :${carton[2]}<br>Carton Id: ${carton[3]}<br>Freight Cost: ${carton[5]}<br>SKU x Quantity: ${carton[6]}`;
					fulfillment.setSublistValue({ sublistId: 'package', line, fieldId: 'packagedescr', value: description.substring(0, Math.min(999, description.length)) });	
				});	
			}
			else {
				log.error('no carton header information (carrier, tracking number, etc.) found for this order. No package was created.', {fulfillmentResponse});
			}
		}
		else {
			fulfillment.insertLine({ sublistId: 'package', line: 0 });
			fulfillment.setSublistValue({ sublistId: 'package', line: 0, fieldId: 'packageweight', value: '1' });
			fulfillment.setSublistValue({ sublistId: 'package', line: 0, fieldId: 'packagetrackingnumber', value: fulfillmentResponse.message.carrier_tracking_number });	
		}

		// map fulfillment response item array to SKU=>qty object
		var items = fulfillmentResponse.message.items;
		var shippedQuantityRemaining = {};
		for (var i = 0; i < items.length; ++i) {
			shippedQuantityRemaining[items[i].sku] = (parseInt(shippedQuantityRemaining[items[i].sku]) || 0) + items[i].total_units;
		}

		log.debug('shippedQuantityRemaining', shippedQuantityRemaining);

		var fulfilling = false;
		var partiallyShipped = false;

		var itemFirstFulfillmentLine = {};

		// traverse item list and apply shippable quantity from fulfillment response
		for (var i = 0; i < fulfillment.getLineCount({ sublistId: 'item' }); ++i) {
			var sku = fulfillment.getSublistValue({ sublistId: 'item', line: i, fieldId: 'itemname'});
			var qtyToShip = parseInt(fulfillment.getSublistValue({ sublistId: 'item', line: i, fieldId: 'quantityremaining'})) || 0;

			log.debug('line to ship', {
				sku: sku,
				quantity: qtyToShip,
				line: i
			});

			// in case of extra quantity, we will refer back to the first appearance of the SKU
			// and add the quantity there
			itemFirstFulfillmentLine[sku] = itemFirstFulfillmentLine[sku] == undefined ? i : itemFirstFulfillmentLine[sku];

			log.debug('itemFirstFulfillmentLine', itemFirstFulfillmentLine);

			if (qtyToShip > 0) {
				if (shippedQuantityRemaining[sku] > 0) {
					log.debug('shippedQuantityRemaining', shippedQuantityRemaining[sku]);

					// ship this line, at least partially
					fulfillment.setSublistValue({ sublistId: 'item', line: i, fieldId: 'itemreceive', value: true });

					// clamp ship quantity to fulfillment response for partial shipment
					if (qtyToShip > shippedQuantityRemaining[sku]) {
						qtyToShip = shippedQuantityRemaining[sku];
						partiallyShipped = true;
					}

					fulfillment.setSublistValue({ sublistId: 'item', line: i, fieldId: 'quantity', value: qtyToShip });

					// Set fulfilled warehouse location for each item
					fulfillment.setSublistValue({ sublistId: 'item', line: i, fieldId: 'location', value: fulfillmentResponse.location });

					// remove shipped quantity from fulfillment response total in case this line appears later in the order
					shippedQuantityRemaining[sku] -= qtyToShip;
					fulfilling = true;
				}
				else {
					// did not have any stock for this line
					log.debug('item not shipped', sku);
					partiallyShipped = true;
				}
			}
		}

		log.debug('shippedQuantityRemaining left after fulfilling order quantities', shippedQuantityRemaining);

		for (var sku in shippedQuantityRemaining) {
			if (shippedQuantityRemaining[sku] > 0) {
				log.debug('fulfilling extra quantity', {
					sku: sku,
					quantity: shippedQuantityRemaining[sku],
					line: itemFirstFulfillmentLine[sku]
				});

				if (itemFirstFulfillmentLine[sku] != undefined) {
					// add extra quantity to first appearance of the SKU in the fulfillment
					var alreadyShippedQuantity = parseInt(fulfillment.getSublistValue({ sublistId: 'item', line: itemFirstFulfillmentLine[sku], fieldId: 'quantity' })) || 0;

					fulfillment.setSublistValue({
						sublistId: 'item',
						line: itemFirstFulfillmentLine[sku],
						fieldId: 'quantity',
						value: alreadyShippedQuantity + shippedQuantityRemaining[sku]
					});
				}
				else {
					// don't have a line for this item at all
					throw error.create({
						name: 'shipment data error',
						message: 'fulfillment response contains item(s) not on the order'
					});
				}
			}
		}

		log.debug('fulfilling any item', fulfilling);

		if (fulfilling) {
			log.debug('fulfillmentResponse.fulfillment', fulfillmentResponse.fulfillment);
			fulfillmentResponse.fulfillment = fulfillment.save();
			fulfillmentResponse.status = FulfillmentStatus.Fulfilled;
			update3plShipDate(fulfillmentResponse);
		}
		else {
			throw error.create({
				name: 'shipment data error',
				message: 'some item quantities in the order cannot be fulfilled'
			});
		}
	}

	function update3plShipDate(fulfillmentResponse) {
		if (fulfillmentResponse.orderType !== 'transferorder') {
			try {
				record.submitFields({
					type: 'salesorder',
					id: fulfillmentResponse.order,
					values: {
						'custbody_cb_3pl_ship_date_so': format.parse({value: new Date(fulfillmentResponse.shipDate), type: format.Type.DATE})
					}
				});		
			}
			catch (e) {
				log.error('Sales order 3PL ship date update failed', e);
			}
		}  
	}

	function closeOrder(id, orderType) {
		var order = record.load({
			type: (orderType === 'transferorder') ? 'transferorder' : 'salesorder',
			id: id
		});

		for (var i = 0; i < order.getLineCount({ sublistId: 'item' }); ++i) {
			if (order.getSublistValue({ sublistId: 'item', line: i, fieldId: 'itemtype' }) != 'EndGroup') {
				order.setSublistValue({ sublistId: 'item', line: i, fieldId: 'isclosed', value: true });
			}
		}

		order.save();
	}

	function getOrderLineDetails(id) {
		var orderSearch = search.create({
			type: 'salesorder',
			filters: [
				['internalid', 'is', id], 
				'and', 
				['mainline', 'is', 'F'], 
				'and', 
				['taxline', 'is', 'F'], 
				'and', 
				['shipping', 'is', 'F']
			],
			columns: ['quantity', 'quantityshiprecv', 'quantitybilled', 'item', 'line']
		});

		var orderLineDetails = {};

		orderSearch.run().each(function(result) {
			orderLineDetails[result.getValue('line')] = {
				item: result.getValue('item'),
				quantity: parseInt(result.getValue('quantity')) || 0,
				quantityshiprecv: parseInt(result.getValue('quantityshiprecv')) || 0,
				quantitybilled: parseInt(result.getValue('quantitybilled')) || 0
			}

			return true;
		});

		return orderLineDetails;
	}

	function billOrder(fulfillmentResponse) {
		log.debug('billOrder context', fulfillmentResponse);
		var billOrderedQuantity = false;
		var billOrder = false;
		var limitBillingToOrder;

		// close orders of these types if completely fulfilled
		const autoCloseOrderTypes = [
			'Resend',
			'ShipRequest',
			'SPECIAL'
		];

		if (autoCloseOrderTypes.indexOf(fulfillmentResponse.orderType) >= 0 && fulfillmentResponse.orderStatus == 'Pending Billing') {
			log.debug('non-billing order complete - closing order');
			closeOrder(fulfillmentResponse.order, fulfillmentResponse.orderType);
		}
		else if (fulfillmentResponse.orderType == 'B2C' || fulfillmentResponse.orderType == 'INTL' || fulfillmentResponse.orderType == 'Wholesale') {
			// if B2C or INTL order, bill mininum of ordered and fulfilled quantity (override NetSuite standard logic for overfulfillments)
			billOrder = true;

			limitBillingToOrder = getOrderLineDetails(fulfillmentResponse.order);
		}


		if (billOrder && fulfillmentResponse.orderType !== 'transferorder') {
			var billingType = fulfillmentResponse.paymentMethod ? 'cashsale' : 'invoice';
			var billingTransaction = record.transform({
				fromType: (fulfillmentResponse.orderType === 'transferorder') ? 'transferorder' : 'salesorder',
				fromId: fulfillmentResponse.order,
				toType: billingType
			});

			billingTransaction.setValue({ fieldId: 'trandate', value: format.parse({value: new Date(fulfillmentResponse.transactionDate), type: format.Type.DATE}) });

			if (limitBillingToOrder) {
				for (var i = 0; i < billingTransaction.getLineCount({ sublistId: 'item' }); ++i) {
					if (billingTransaction.getSublistValue({ sublistId: 'item', line: i, fieldId: 'itemtype' }) != 'EndGroup') {
						var orderLineDetails = limitBillingToOrder[billingTransaction.getSublistValue({ sublistId: 'item', line: i, fieldId: 'orderline' })];

						// shipped more than ordered?
						if (orderLineDetails.quantityshiprecv > orderLineDetails.quantity) {
							// bill remaining ordered quantity
							billingTransaction.setSublistValue({
								sublistId: 'item',
								line: i,
								fieldId: 'quantity',
								value: orderLineDetails.quantity - orderLineDetails.quantitybilled
							});

							// update extended price
							// not necessary for NetSuite, but in case discount prorating needs to happen
							billingTransaction.setSublistValue({
								sublistId: 'item',
								line: i,
								fieldId: 'amount',
								value: billingTransaction.getSublistValue({ sublistId: 'item', line: i, fieldId: 'quantity' }) *
									billingTransaction.getSublistValue({ sublistId: 'item', line: i, fieldId: 'rate' })
							});
						}
					}
				}
			}

			// clear discount if present
			var discountAmount = parseFloat(billingTransaction.getValue({ fieldId: 'discounttotal' })) || 0;
			var discountItem = billingTransaction.getValue({ fieldId: 'discountitem' });

			// prorate discount across assembly and inventory items
			// doesn't handle items that aren't part of a promotion, but it's the best approximation for
			// older format orders, which don't already have Shopify-logic for discounts applied
			if (discountItem) {
				if (canProrateDiscount(fulfillmentResponse, discountItem, discountAmount)) {
					log.debug('clearing and prorating discount', {
						item: discountItem,
						amount: discountAmount
					});

					billingTransaction.setValue({ fieldId: 'discountitem', value: null });

					var subtotal = 0;
					var itemsToDiscount = {};
					for (var i = 0; i < billingTransaction.getLineCount({ sublistId: 'item' }); ++i) {
						var itemType = billingTransaction.getSublistValue({ sublistId: 'item', line: i, fieldId: 'itemtype' });

						// only these item types count toward subtotal for discount prorating
						if (itemType == 'Assembly' || itemType == 'InvtPart') {
							var lineExtendedPrice = parseFloat(billingTransaction.getSublistValue({ sublistId: 'item', line: i, fieldId: 'amount' })) || 0;
							subtotal += lineExtendedPrice;

							itemsToDiscount[i] = {
								amount: lineExtendedPrice,
								quantity: billingTransaction.getSublistValue({ sublistId: 'item', line: i, fieldId: 'quantity' })
							};
						}
					}

					// prorate the discount across the valid items gathered above
					for (var i in itemsToDiscount) {
						// discount based on line amount (extended price)
						var discountForLine = itemsToDiscount[i].amount / subtotal * discountAmount;
						var discountedAmount = itemsToDiscount[i].amount + discountForLine;

						// calculate discounted unit price
						var discountedRate  = discountedAmount / itemsToDiscount[i].quantity;

						// force custom pricing and update unit and extended price
						billingTransaction.setSublistValue({ sublistId: 'item', line: i, fieldId: 'pricelevel', value: '-1' });
						billingTransaction.setSublistValue({ sublistId: 'item', line: i, fieldId: 'rate', value: discountedRate });
						billingTransaction.setSublistValue({ sublistId: 'item', line: i, fieldId: 'amount', value: discountedAmount });
					}
				}
				else {
					throw error.create({
						name: 'DISCOUNT ERROR',
						message: 'discount cannot be prorated, billing skipped'
					});
				}
			}

			fulfillmentResponse.billingTransaction = billingTransaction.save();
		}
		else {
			log.debug('billing not required for order', fulfillmentResponse);
		}
	}

	// checks if header discount can be safely prorated
	// returns true if the discount transferred in full to the cash sale
	// returns false if it did not, or if it's not clear that the discount item
	// was the one and only matching discount item in the sales order
	//
	// the consideration of multiple discounts is just that it's no longer clear if we have
	// the right discount to match, since NetSuite doesn't flag the header discount line in
	// any useful way, and the header discount fields aren't searchable themselves
	//
	// the discount would not match the SO if the cash sale is only billing part of the SO
	// that might be that some items were already billed and discounted
	// or that a gift card was already billed - not discounted, but NetSuite seems to think it was,
	// and only carries over a portion of the original discount
	//
	// all this complexity is for the old style of representing discounts.  Once discounted prices
	// are stored directly and no header discount is in play, all this is no longer needed
	function canProrateDiscount(fulfillmentResponse, discountItem, billDiscountAmount) {
		if (discountItem) {
			var soDiscountAmount = 0;
			var discountSearch = search.create({
				type: 'salesorder',
				filters: [
					['internalid', 'is', fulfillmentResponse.order], 'and', ['item', 'is', discountItem]
				],
				columns: 'amount'
			});

			var discountsFound = 0;
			discountSearch.run().each(function(result) {
				++discountsFound;
				soDiscountAmount = result.getValue('amount');
			});

			return discountsFound == 1 && soDiscountAmount == billDiscountAmount;
		}

		return true;
	}

	function updateContext(id, values) {
		if (id) {
			// assume good things have happened
			values.custrecord_afr_failure_count = values.custrecord_afr_failure_count || 0;
			values.custrecord_afr_error_message = values.custrecord_afr_error_message || '';

			record.submitFields({
				type: 'customrecord_amy_fulfillment_response',
				id: id,
				values: values
			});
		}
		else {
			log.error('cannot update fulfillment response status: fResId not set', values);
		}
	}

	function getScriptConfiguration() {
		var scriptObj = runtime.getCurrentScript();

		return {
			senderId: scriptObj.getParameter({ name: 'custscript_amy_frp_email_sender' }),
			templateId: parseInt(scriptObj.getParameter({ name: 'custscript_amy_frp_invoice_template' })),
			ccAddress: scriptObj.getParameter({ name: 'custscript_amy_frp_carbon_copy' })
		};
	}

	return {
		getInputData: getInputData,
		map: map,
		reduce: reduce,
		summarize: function() {}
	};
});

/*
Get fulfillment response (FRes)
...whose failure count < X (script parameter)
...and whose sales orders are 
	* pending fulfillment (NOTE: verify that this status includes those with gift card purchases that were already billed (should be... those aren't fulfillable items))
Create 
	* pending billing/partially fulfilled or pending billing 
		(NOTE: could include the gift card case if billed not based on FRes
	 		- one fulfillment script and one billing script
			- probably not worth optimizing... relatively small order count)

If pending fulfillment
	Fulfill
		* shipped SKUs apply to appearance of item in order sequence (3PL aggregates SKU quantities and reports only one line per SKU)
		* date -> trandate and 3PL ship date
		* trandate first day of first open period if ship date period is closed
		* status = shipped
		* update 3PL actual ship date on sales order
		* set tracking number in package (weight = 1)
		* set carrier (custom field)
	Update internal status to pending billing
	On success, reset failure count
	On failure, increment failure count

If pending billing

Order Type is 
	Resend, ShipRequest: Close after fulfillment complete
	B2C, INTL: bill automatically as cash sale
	B2B: bill automatically as invoice
	BULK: do not bill (like manual B2B)
	Consignment: TBD

	B2B/EDI: bill what was fulfilled (currently bills all billable from the order)
	B2C, INTL: bill what was ordered

	(NOTE: this will catch those that were just billed, or those which fulfilled last time and then failed billing)
	Bill
		* If payment method, as Cash Sale, else as Invoice
		* Prorate header discount if present and remove discount item
			* do not include
				* gift cards
				* round up advanced donation
				* ecom tax total
				* skip item group header and footer
		* trandate same as item fulfillment
		* no 3PL ship date field
	On success, reset failure count
	On failure, increment failure count

Searches
* for failed FRes records (failure count > 0)
	* sort by failure count DESC, create date ASC
	* i.e,. oldest, most persistent failures first

Assumptions:
* there's someone to monitor the failure report

*/