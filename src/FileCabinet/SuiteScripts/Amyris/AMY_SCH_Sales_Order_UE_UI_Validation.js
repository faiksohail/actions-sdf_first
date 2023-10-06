/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NModuleScope SameAccount
 * Version 		Date			Remarks
 * 1.0		15th Sep 2022		This script is responsible to update Shopify Tags and Financial Paid in Sales Order record
 */
define(['N/record', 'N/runtime', 'N/search', 'N/task'],
    function(record, runtime, search, task) {
        /**
         * Definition of the Scheduled script trigger point.
         *
         * @param {Object} scriptContext
         * @param {string} scriptContext.type - The context in which the script is executed. It is one of the values from the scriptContext.InvocationType enum.
         * @Since 2015.2
         */
        function execute(scriptContext) {
            try {
                var scriptObj = runtime.getCurrentScript();
                var recordId = scriptObj.getParameter('custscript_amy_next_rec_id'); // get next processing record ID from script parameter
                processSalesOrder(scriptObj, recordId); // function to process salesorder transaction records
            } catch (e) {
                log.error('execute Error', e.message);
            }
        }
        // FUNCTION TO PROCESS SALESORDER RECORDS
        function processSalesOrder(scriptObj, recordId) {
            try {
                /*var filters = [
                    ["type","anyof","SalesOrd"], // type should be sales order transaction
					"AND", 
					["mainline","is","T"], 
					"AND", 
					["custbody_amy_ready_for_3pl_transmit","is","F"], // Ready to 3PL should be false
					"AND", 
					["custbody_amyris_cb_sent_to_3pl","is","F"], // Sent to 3PL should be false
					"AND", 
					["custbody_amy_order_tags","noneof","@NONE@"], // Shopify Tags should be NOT empty					
					"AND", 
					["trandate","onorafter","9/1/2022"]	// Trandate on or after 1st Sept 2022
                ]; */
                var filters = [
                    ["type", "anyof", "SalesOrd"],
                    "AND",
                    ["mainline", "is", "T"],
                    "AND",
                    ["trandate", "onorafter", "10/1/2022"],
                    "AND",
                    ["custbody_amy_shopify_financial_status", "doesnotcontain", "voided"],
                    "AND",
                    ["custbody_amy_shopify_financial_status", "doesnotcontain", "refunded"],
                    "AND",
                    ["status", "noneof", "SalesOrd:H", "SalesOrd:C"],
                    "AND",
                    ["systemnotes.type", "is", "T"],
                    "AND",
                    ["custbody_amy_order_tags.internalidnumber", "isnotempty", ""],
                    "AND", 
                    ["custbody_amy_ready_for_3pl_transmit","is","F"]
                ]
                if (recordId != undefined && recordId != null && recordId != '') { // if script parameter is not empty which implicates script has been rerun
                    addFilter = ["internalidnumber", "greaterthanorequalto", recordId];
                    filters.push("AND");
                    filters.push(addFilter);
                }
                var soSearch = search.create({
                    type: "salesorder", // transaction search for sales order
                    filters: filters,
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            sort: search.Sort.ASC,
                            label: "Internal ID"
                        }), // Internal id of the sales order
                        search.createColumn({
                            name: "custbody_amy_order_tags",
                            label: "Shopify Tags"
                        }), // Shopify Tags
                        search.createColumn({ // Financial Status
                            name: "custbody_amy_shopify_financial_status",
                            join: "billingTransaction",
                            label: "Financial Status"
                        }),
                    ]
                });
                var searchCount = soSearch.runPaged().count;
                log.debug("soSearch result count", searchCount);
                if (searchCount > 0) {
                    var searchResultNo = 0;
                    soSearch.run().each(function(result) {
                        var remainingUsage = scriptObj.getRemainingUsage(); // get current script remaining usage						
                        if (searchResultNo < 3999 && remainingUsage > 20) {
                            var recObj = record.load({ // load record
                                type: 'salesorder',
                                id: result.getValue('internalid'),
                                isDynamic: true,
                            });
                            //recObj.setValue('custbody_amy_order_tags', // '1806'); // set Shopify Tags to "UE UI Validation"
                            recObj.setValue('custbody_amy_ready_for_3pl_transmit', true);
                            recObj.save(); // save record to trigger User Event (Before Submit)
                            searchResultNo++;
                        } else {
                            log.audit('processSalesOrder Reschedule - remainingUsage: ' + remainingUsage);
                            log.audit('processSalesOrder Reschedule - searchResultNo: ' + searchResultNo);
                            var scheduledScriptTask = task.create({ // rescheduling the script
                                taskType: task.TaskType.SCHEDULED_SCRIPT,
                                scriptId: runtime.getCurrentScript().id,
                                deploymentId: runtime.getCurrentScript().deploymentId,
                                params: {
                                    'custscript_amy_next_rec_id': result.getValue('internalid') // store the next internal that needs to be processed next.
                                }
                            });
                            scheduledScriptTask.submit(); // submit the script to rerun the schedule script
                        }
                        return true;
                    });
                }
            } catch (e) {
                log.error('');
            }
        }
        return {
            execute: execute
        };
    });