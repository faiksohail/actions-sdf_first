/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope Public
 * Version		Date				Remarks
 * 1.0		23rd August, 2023		This script is responsible to set the following missing information on Open/Pending Approval Bills - prior to the 10th August, 2023:
 *									a) Critical Status
 *									b) Original NS Number
 *									c) Brand Code
 *									d) SAP Profit Center
 *									e) SAP Cost Center
 */
define(['N/search', 'N/record'], function(search, record) {
    function getInputData(context) {
        try {
            var VBSearch = search.create({
                type: "transaction",
                filters: [
                    ["mainline", "is", "T"],
                    "AND",
                    ["status", "anyof", "VendBill:A", "VendBill:D"],
                    "AND",
                    ["totalamount", "greaterthanorequalto", "0.01"],
                    "AND",
                    ["createdby", "noneof", "3328", "2953"],
                    "AND",
                    ["trandate", "onorbefore", "8/22/2023"]
                    //"AND",
                    //["internalidnumber","equalto","42975179"]
                ],
                columns: [
                    search.createColumn({
                        name: "custentity_amy_critical_status",
                        join: "vendor",
                        label: "Critical Status"
                    }),
                    search.createColumn({
                        name: "transactionnumber",
                        label: "Original NS Number"
                    }),
                    search.createColumn({
                        name: "custrecord_amy_brand_code",
                        join: "class",
                        label: "Brand Code"
                    }),
                    search.createColumn({
                        name: "custrecord_amy_sap_cost_center",
                        join: "department",
                        label: "SAP Cost Center"
                    }),
                    search.createColumn({
                        name: "custrecord_cb_class_num",
                        join: "class",
                        label: "SAP Profit Center"
                    }),
                ]
            });
            var searchResultCount = VBSearch.runPaged().count;
            log.debug("getInputData - searchResultCount: " + searchResultCount);
            return VBSearch;
        } catch (e) {
            log.error("getInputData Error", e.message);
        }
    }

    function map(context) {
        try {
            var searchResult = JSON.parse(context.value);
            //log.debug('searchResult', searchResult);
            var critical_status = searchResult.values["custentity_amy_critical_status.vendor"].value; // get Critical Status
            //log.debug('critical_status', critical_status);
            var recId = searchResult.id; // get transaction record internal id
            //log.debug('recId', recId);
            var original_ns_number = searchResult.values.transactionnumber; // get Original NetSuite Transaction Reference
            //log.debug('original_ns_number', original_ns_number);
            var brand_code = searchResult.values["custrecord_amy_brand_code.class"]; // get Brand Code
            //log.debug('brand_code', brand_code);
            var sap_profit_center = searchResult.values["custrecord_cb_class_num.class"]; // get SAP Profit Center
            //log.debug('sap_profit_center', sap_profit_center);
            var sap_cost_center = searchResult.values["custrecord_amy_sap_cost_center.department"]; // get SAP Cost Center
            //log.debug('sap_cost_center', sap_cost_center);

            try {
                // update transaction record
                record.submitFields({
                    type: "vendorbill",
                    id: recId,
                    values: {
                        custbody_amy_critical_status: critical_status, // set Critical Status
                        custbody_amy_original_ns_number: original_ns_number, // set Original NetSuite Number
                        custbody_amy_brand_code: brand_code, // set Brand Code
                        custbody_amy_sap_profit_center: sap_profit_center, // set SAP Profit Center
                        custbody_amy_sap_cost_center_code: sap_cost_center //  set SAP Cost Center
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });
                log.debug('New Fields Updated Successfully...');
            } catch (e) {
                var errorMsg = "Error for recId: " + recId + " & msg: " + e.message;
                log.error("Update Error", errorMsg);
            }
        } catch (e) {
            log.error("map Error", e.message);
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