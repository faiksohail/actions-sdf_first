/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * Version		Date				Remarks
 * 1.0 			9h Sep, 2023 		1. This script is responsible to update "Terms" in Post Petition Purchase Order record to NET15.			
 */
define(['N/record', 'N/search', 'N/runtime', 'N/error', 'N/email'],
    function(record, search, runtime, error, email) {

        function getInputData() {
            try {
                var scriptObj = runtime.getCurrentScript();
                var poId = scriptObj.getParameter("custscript_amy_po_internal_id");
                // construct search filter
                var filter = [
                    ["type", "anyof", "PurchOrd"],
                    "AND",
                    ["mainline", "is", "T"],
                    "AND",
                    ["custbody_amy_petition_status", "anyof", "2"],
                    "AND",
                    ["terms", "noneof", "12"]
                ];
                if (poId != undefined && poId != null && poId != "") {
                    var poIdFilter = ["internalidnumber", "equalto", poId];
                    filter.push("AND");
                    filter.push(poIdFilter);
                }
                var poSearch = search.create({
                    type: "purchaseorder",
                    filters: filter,
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            sort: search.Sort.ASC,
                            label: "Internal ID"
                        }),
                        search.createColumn({
                            name: "statusref",
                            label: "Status"
                        })
                    ]
                });
                var poSearchCount = poSearch.runPaged().count;
                log.debug("getInputData - poSearchCount: " + poSearchCount);
                return poSearch;
            } catch (e) {
                log.error('getInputData Error', e.message);
            }
        }

        function map(context) {
            try {
                // get search results
                var searchResult = JSON.parse(context.value);
                var poId = searchResult.id;
                var poStatus = searchResult.values["statusref"].text;
                try {
                    updatePOTerms(poId); // update purchase order terms
                    updateRelatedPOBills(poId); // update terms on related po bills
                } catch (e) {
                    var errorMsg = "Record Update error: " + poId;
                    log.error("Transaction Update Error", errorMsg);
                }
            } catch (e) {
                log.error('map Error', e.message);
            }
        }
        // FUNCTION TO UPDATE PURCHASE ORDER TERMS
        function updatePOTerms(poId) {
            try {
                // load purchase order record
                var poRec = record.load({
                    type: "purchaseorder",
                    id: poId,
                    isDynamic: false,
                });
                // update header and line level po terms
                if (poRec != undefined && poRec != null && poRec != "") {
                    poRec.setValue("terms", "12"); // set payment terms to NT15
                    // update line level supplier terms
                    var daysNetDue = getDaysNetDue("12"); // get days net due for NT15 terms
                    if (daysNetDue != undefined && daysNetDue != null && daysNetDue != "") {
                        var itemCount = poRec.getLineCount("item");
                        for (var i = 0; i < itemCount; i++) {
                            poRec.setSublistValue("item", "custcol_amy_po_supplier_terms", i, daysNetDue);
                        }
                    }
                }
                // save purchase order record
                poRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
            } catch (e) {
                log.error("updatePOTerms Error", e.message);
            }
        }
        // UPDATE TERMS ON RELATED PO BILLS
        function updateRelatedPOBills(poId) {
            try {
                var poSearch = search.create({
                    type: "purchaseorder",
                    filters: [
                        ["type", "anyof", "PurchOrd"],
                        "AND",
                        ["internalidnumber", "equalto", poId],
                        "AND",
                        ["applyingtransaction.type", "anyof", "VendBill"]
                    ],
                    columns: [
                        search.createColumn({
                            name: "applyingtransaction",
                            summary: "GROUP",
                            label: "Applying Transaction"
                        })
                    ]
                });
                var searchCount = poSearch.runPaged().count;
                if (searchCount > 0) {
                    poSearch.run().each(function(result) {
                        var billId = result.getValue({
                            name: "applyingtransaction",
                            summary: "GROUP"
                        }); // get related vendor bill id
                        try {
                            updateBillTerms(billId); // update terms on bills
                        } catch (e) {
                            var errorMsg = "Record Update error: " + billId;
                            log.error("Bill Update Error", errorMsg);
                        }
                        return true;
                    });
                }
            } catch (e) {
                log.error("updateRelatedPOBills Error", e.message);
            }
        }
        // FUNCTION TO UPDATE BILL TERMS
        function updateBillTerms(billId) {
            try {
                // load purchase order record
                var billRec = record.load({
                    type: "vendorbill",
                    id: billId,
                    isDynamic: false,
                });
                // update header and line level po terms
                if (billRec != undefined && billRec != null && billRec != "") {
                    billRec.setValue("terms", "12"); // set payment terms to NT15
                    // update line level supplier terms
                    var daysNetDue = getDaysNetDue("12"); // get days net due for NT15 terms
                    if (daysNetDue != undefined && daysNetDue != null && daysNetDue != "") {
                        var itemCount = billRec.getLineCount("item");
                        for (var i = 0; i < itemCount; i++) {
                            billRec.setSublistValue("item", "custcol_amy_po_supplier_terms", i, daysNetDue);
                        }
                    }
                }
                // save purchase order record
                billRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
            } catch (e) {
                log.error("updateBillTerms Error", e.message);
            }
        }
        // FUNCTION TO GET DAYS NET DUE FROM SEARCH
        function getDaysNetDue(terms) {
            try {
                var daysNetDue = null;
                var termLookUp = search.lookupFields({
                    type: "term",
                    id: terms,
                    columns: ['daysuntilnetdue']
                });
                if (termLookUp != undefined && termLookUp != null && termLookUp != "") {
                    daysNetDue = termLookUp.daysuntilnetdue;
                }
                return daysNetDue;
            } catch (e) {
                log.error("getDaysNetDue Error", e.message);
            }
        }

        function reduce(context) {
            log.audit('reduce context', context);
        }

        function summarize(summary) {
            log.debug('summarize context', summary);
        };

        return {
            getInputData: getInputData,
            map: map,
            //reduce: reduce,
            //summarize: summarize,
        }
    });