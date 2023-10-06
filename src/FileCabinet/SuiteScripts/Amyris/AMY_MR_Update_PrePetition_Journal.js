/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope Public
 * Version		Date				Remarks
 * 1.0		30th August, 2023		Update existing PrePetition Journal Entry with Remaining Bill amount.
 */
define(['N/search', 'N/record', 'N/runtime'], function(search, record, runtime) {
    function getInputData(context) {
        try {
            var vbSearch = search.create({
                type: "vendorbill",
                filters: [
                    ["type", "anyof", "VendBill"],
                    "AND",
                    ["mainline", "is", "T"],
                    "AND",
                    ["internalidnumber", "notequalto", "3211352"],
                    "AND",
                    ["custbody_amy_prepetition_reclass_je.internalidnumber", "isnotempty", ""],
                    "AND",
                    ["max(formulanumeric: {totalamount} - {amountpaid})", "greaterthan", "0"],
                    "AND",
                    ["max(formulanumeric: {amountpaid})", "greaterthan", "0"]
                ],
                columns: [
                    search.createColumn({
                        name: "internalid",
                        summary: "GROUP",
                        sort: search.Sort.ASC,
                        label: "Internal ID"
                    }),
                    search.createColumn({
                        name: "amountremaining",
                        summary: "MAX",
                        label: "Amount Remaining"
                    })
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
            var vbId = searchResult.values["GROUP(internalid)"].value; // get vendor bill ID
            var remBillAmt = searchResult.values["MAX(amountremaining)"]; // get remaining amount
            updatePrePetJE(vbId, remBillAmt); // function to create Pre-Petition Journal
        } catch (e) {
            var errorMsg = "Error for recId: " + recId + " & msg: " + e.message;
            log.error("Update Error", errorMsg);
        }
    }

    // FUNCTION TO CREATE PRE-PETITION JOURNAL ENTRY
    function updatePrePetJE(vbId, remBillAmt) {
        try {
            // load vendor bill record
            var vbRec = record.load({
                type: "vendorbill",
                id: vbId,
                isDynamic: true,
            });
            // get linked JE record
            var linkedJE = vbRec.getValue("custbody_amy_prepetition_reclass_je");
            if (linkedJE != undefined && linkedJE != null && linkedJE != "") {
                var jeRec = record.load({
                    type: "journalentry",
                    id: linkedJE,
                    isDynamic: true,
                });
                var lineCount = jeRec.getLineCount("line");
                if (lineCount > 0) {
                    for (var i = 0; i < lineCount; i++) {
                        var debitAmount = jeRec.getSublistValue("line", "debit", i); // get debit amount
                        var creditAmount = jeRec.getSublistValue("line", "credit", i); // get credit amount

                        jeRec.selectLine("line", i);
                        if (debitAmount != undefined && debitAmount != null && debitAmount != "") {
                            jeRec.setCurrentSublistValue("line", "debit", remBillAmt);
                        }
                        if (creditAmount != undefined && creditAmount != null && creditAmount != "") {
                            jeRec.setCurrentSublistValue("line", "credit", remBillAmt);
                        }
                        jeRec.commitLine("line");
                    }
                }
                jeRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
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