/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * Version			Date			Remarks
 * 1.0 			3rd Oct, 2023 		1. This script is responsible to update "Approval Status" of Pre Petition Journals to approved.		
 */
define(['N/record', 'N/search', 'N/runtime', 'N/error'],
    function(record, search, runtime, error) {

        function getInputData() {
            try {
                var jeSearch = search.create({
                    type: "journalentry",
                    filters: [
                        ["type", "anyof", "Journal"],
                        "AND",
                        ["mainline", "is", "T"],
                        "AND",
                        ["custbody_amy_petition_status", "anyof", "3"],
                        "AND",
                        ["custbody_amy_created_by", "anyof", "2953"],
                        "AND",
                        ["status", "anyof", "Journal:A"],
                        "AND",
                        ["systemnotes.type", "is", "T"],
                        "AND",
                        ["systemnotes.context", "anyof", "MPR"],
                        "AND",
                        ["systemnotes.name", "anyof", "-4"]
                        //"AND",
                        //["internalidnumber", "equalto", "47520725"]
                    ],
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            summary: "GROUP",
                            sort: search.Sort.ASC,
                            label: "Internal ID"
                        })
                    ]
                });
                var jeSearchCount = jeSearch.runPaged().count;
                log.debug("getInputData - jeSearchCount: " + jeSearchCount);
                return jeSearch;
            } catch (e) {
                log.error('getInputData Error', e.message);
            }
        }

        function map(context) {
            try {
                // get search results
                var searchResult = JSON.parse(context.value);
                log.debug("searchResult", searchResult);
                var jeId = searchResult.values["GROUP(internalid)"].value;
                log.debug("map - jeId: " + jeId);

                try {
                    updateJEApproval(jeId); // update journal entry approval to approved
                } catch (er) {
                    var errorMsg = "Error on JE ID: " + jeId + " :" + er.message;
                    log.error("Error on JE Update", errorMsg);
                }
            } catch (e) {
                log.error('map Error', e.message);
            }
        }

        // FUNCTION TO UPDATE JOURNAL ENTRY APPROVAL
        function updateJEApproval(jeId) {
            try {
                record.submitFields({
                    type: "journalentry",
                    id: jeId,
                    values: {
                        approvalstatus: "2"	// approved
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });
            } catch (e) {
                log.error("updateJEApproval Error", e.message);
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