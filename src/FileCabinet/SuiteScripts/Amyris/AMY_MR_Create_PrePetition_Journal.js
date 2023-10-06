/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope Public
 * Version		Date				Remarks
 * 1.0		29th August, 2023		Retrieve PrePetition Bills and create corresponding Journal Entries for the same.  
 */
define(['N/search', 'N/record', 'N/runtime'], function(search, record, runtime) {
    function getInputData(context) {
        try {
            // get script parameters
            var scriptObj = runtime.getCurrentScript();
            var billId = scriptObj.getParameter("custscript_amy_vb_internal_id"); // get bill internal id

            var filters = [
                ["type", "anyof", "VendBill"],
                "AND",
                ["custbody_amy_petition_status", "anyof", "3"],
                "AND",
                ["status", "anyof", "VendBill:A"],
                "AND",
                ["mainline", "is", "T"],
                "AND",
                ["custbody_amy_prepetition_reclass_je.internalidnumber", "isempty", ""]
            ];
            if (billId != undefined && billId != null && billId != "") {
                var billFilter = ["internalidnumber", "equalto", billId];
                filters.push("AND");
                filters.push(billFilter);
            }
            var vbSearch = search.create({
                type: "vendorbill",
                filters: filters,
                columns: [
                    search.createColumn({
                        name: "internalid",
                        label: "Internal ID"
                    }),
                    search.createColumn({
                        name: "custbody_amy_petition_status",
                        label: "Petition Status"
                    }),
                    search.createColumn({
                        name: "amountremaining",
                        label: "Amount Remaining"
                    }),
                    search.createColumn({
                        name: "subsidiary",
                        label: "Subsidiary"
                    }),
                    search.createColumn({
                        name: "department",
                        label: "Cost Center"
                    }),
                    search.createColumn({
                        name: "class",
                        label: "Brand"
                    }),
                    search.createColumn({
                        name: "entity",
                        label: "Name"
                    }),
                    search.createColumn({
                        name: "memomain",
                        label: "Memo (Main)"
                    }),
					search.createColumn({name: "currency", label: "Currency"})
                ]
            });
            var searchResultCount = vbSearch.runPaged().count;
            log.debug("vbSearch result count", searchResultCount);

            return vbSearch;
        } catch (e) {
            log.error("getInputData Error", e.message);
        }
    }

    function map(context) {
        try {
            // get search results
            var searchResult = JSON.parse(context.value);
            var vbId = searchResult.id; // get vendor bill ID
            var petitionStatus = searchResult.values["custbody_amy_petition_status"].value; // get petition status
            var billAmount = searchResult.values["amountremaining"]; // get vendor bill remaining amount
            var subsidiary = searchResult.values["subsidiary"].value; // get subsidiary
            var costCenter = searchResult.values["department"].value; // get cost center
            var brand = searchResult.values["class"].value; // get class
            var vendor = searchResult.values["entity"].value; // get vendor
            var memo = searchResult.values["memomain"]; // get memo
			var currency = searchResult.values["currency"].value; // get currency
            // get default script parameters
            var scriptObj = runtime.getCurrentScript();
            var custJEForm = scriptObj.getParameter("custscript_amy_custom_je_form"); // get custom JE form
            var defaultCreatedBy = scriptObj.getParameter("custscript_amy_default_created_by"); // get default created by
			var apTradeAct = scriptObj.getParameter("custscript_amy_ap_trade_accnt"); // get AP Trade Account
			var apPrePetAct = scriptObj.getParameter("custscript_amy_ap_prepet_account"); // get AP Pre-Petition Account
            createPrePetitionJournal(vbId, petitionStatus, billAmount, subsidiary, costCenter, brand, vendor, memo, custJEForm, defaultCreatedBy, apTradeAct, apPrePetAct, currency); // function to create Pre-Petition Journal
        } catch (e) {
            var errorMsg = "Error for recId: " + recId + " & msg: " + e.message;
            log.error("Update Error", errorMsg);
        }
    }

    // FUNCTION TO CREATE PRE-PETITION JOURNAL ENTRY
    function createPrePetitionJournal(vbId, petitionStatus, billAmount, subsidiary, costCenter, brand, vendor, memo, custJEForm, defaultCreatedBy, apTradeAct, apPrePetAct, currency) {
        try {
            // create journal entry record
            var jeRecord = record.create({
                type: "journalentry",
                isDynamic: true,
            });
            // set header field values
            jeRecord.setValue("customform", custJEForm); // set AMY | JE | Petition form
            jeRecord.setValue("subsidiary", subsidiary); // set subisidiary
            jeRecord.setValue("approvalstatus", "2"); // set approval status to approved
            jeRecord.setValue("custbody_amy_je_cost_center", costCenter); // set cost center
            jeRecord.setValue("custbody_amy_je_brand", brand); // set brand
			jeRecord.setValue("currency", currency); // set currency
            jeRecord.setValue("custbody_amy_je_vendor", vendor); // set je supplier(vendor) 
            jeRecord.setValue("custbody_amy_petition_status", petitionStatus); // set petition status 
            jeRecord.setValue("custbody_amy_created_by", defaultCreatedBy); // set created by to Michele Seymour 
            jeRecord.setValue("nextapprover", ""); // set next approver to empty
			jeRecord.setValue("custbody_amy_ns_support_comment", "Script Created JE based on VB Pre-Petition Status"); // set NS Support Comments
            // set lines
            for (var i = 0; i < 2; i++) {
                jeRecord.selectLine("line", i);
                if (i == 0) { // if line 1
                    jeRecord.setCurrentSublistValue("line", "account", apTradeAct); // set account to "Accounts Payable (trade)"
                    jeRecord.setCurrentSublistValue("line", "debit", billAmount); // set debit amount
                } else if (i == 1) {
                    jeRecord.setCurrentSublistValue("line", "account", apPrePetAct); // set account to "Accounts Payable (Pre-Petition)"
                    jeRecord.setCurrentSublistValue("line", "credit", billAmount); // set credit amount
                }
                jeRecord.setCurrentSublistValue("line", "department", costCenter); // set cost center
                jeRecord.setCurrentSublistValue("line", "class", brand); // set brand
                jeRecord.setCurrentSublistValue("line", "memo", memo); // set brand
				jeRecord.setCurrentSublistValue("line", "entity", vendor); // set vendor
                jeRecord.setCurrentSublistValue("line", "custcol_amy_petition_status", petitionStatus); // set petition status
                jeRecord.setCurrentSublistValue("line", "custcol_amy_supplier_inv", vbId); // set supplier invoice no. 
                jeRecord.commitLine("line");
            }
            // save record
            var jeId = jeRecord.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });
            log.debug("createPrePetitionJournal - jeId: " + jeId);
            if (jeId != undefined && jeId != null && jeId != "") {
                // link vendor bill record with journal entry
                record.submitFields({
                    type: "vendorbill",
                    id: vbId,
                    values: {
                        custbody_amy_prepetition_reclass_je: jeId,
						custbody_amy_ap_prepetition: apPrePetAct
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });
            }
        } catch (e) {
            log.error("createPrePetitionJournal Error", e.message);
        }
    }

    function handleError(context, error) {
        log.error({
            title: 'Error in Map/Reduce script',
            details: error
        });
    }
    return {
        getInputData: getInputData,
        map: map,
        handleError: handleError
    };
});