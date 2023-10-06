/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope Public
 * Version			Date				Remarks
 * 1.0			5th September, 2023		To restrict selection of pre-petion cost centers. 
 */
define(['N/search', 'N/record'],
    function(search, record) {
        /**
         * Function to be executed after page is initialized.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.mode - The mode in which the record is being accessed (create, copy, or edit)
         *
         * @since 2015.2
         */
        var MODE = null;
        var curRec = null;

        function pageInit(scriptContext) {
            try {
                MODE = scriptContext.mode;
                curRec = scriptContext.currentRecord;
            } catch (e) {
                log.error("pageInit Error", e.message);
            }
        }
        /**
         * Function to be executed when field is changed.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         * @param {string} scriptContext.fieldId - Field name
         * @param {number} scriptContext.lineNum - Line number. Will be undefined if not a sublist or matrix field
         * @param {number} scriptContext.columnNum - Line number. Will be undefined if not a matrix field
         *
         * @since 2015.2
         */
        function fieldChanged(scriptContext) {
            try {
                var fieldId = scriptContext.fieldId;
                var currentRecord = scriptContext.currentRecord;
                if (fieldId == "department" && (MODE == "create" || MODE == "copy")) {
                    var costCenter = currentRecord.getValue("department");
                    var isPrePetCostCenter = verifyPrePetCostCenter(costCenter); // check if the selected cost center is a valid pre-petition cost center
                    if (isPrePetCostCenter == true) {
                        alert("The selected Cost Center is a Pre-Petition Cost Center. Please select a non-Pre-Petition Cost Center.");
                        currentRecord.setValue({
                            fieldId: "department",
                            value: "",
                            ignoreFieldChange: true
                        });
                    }
                }
            } catch (e) {
                log.error("fieldChanged Error", e.message)
            }
        }
        // FUNCTION TO VERIFY IF PRE-PETITION COST CENTER
        function verifyPrePetCostCenter(costCenter) {
            try {
                var isPrePetCostCenter = false;
                var costCenterLookUp = search.lookupFields({
                    type: "department",
                    id: costCenter,
                    columns: ['custrecord_amy_costcenter_petition_stat']
                });
                if (costCenterLookUp != undefined && costCenterLookUp != null && costCenterLookUp != "") {
                    var petStatus = costCenterLookUp.custrecord_amy_costcenter_petition_stat[0].value;
                    log.debug("verifyPrePetCostCenter - petStatus: " + petStatus);
                    if (petStatus == "3") { // if petition status is Pre-Petition
                        isPrePetCostCenter = true;
                    }
                }
                return isPrePetCostCenter;
            } catch (e) {
                log.error("verifyPrePetCostCenter Error", e.message);
            }
        }
        /**
         * Function to be executed when field is slaved.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         * @param {string} scriptContext.fieldId - Field name
         *
         * @since 2015.2
         */
        function postSourcing(scriptContext) {}
        /**
         * Function to be executed after sublist is inserted, removed, or edited.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         *
         * @since 2015.2
         */
        function sublistChanged(scriptContext) {}
        /**
         * Function to be executed after line is selected.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         *
         * @since 2015.2
         */
        function lineInit(scriptContext) {}
        /**
         * Validation function to be executed when field is changed.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         * @param {string} scriptContext.fieldId - Field name
         * @param {number} scriptContext.lineNum - Line number. Will be undefined if not a sublist or matrix field
         * @param {number} scriptContext.columnNum - Line number. Will be undefined if not a matrix field
         *
         * @returns {boolean} Return true if field is valid
         *
         * @since 2015.2
         */
        function validateField(scriptContext) {}
        /**
         * Validation function to be executed when sublist line is committed.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         *
         * @returns {boolean} Return true if sublist line is valid
         *
         * @since 2015.2
         */
        function validateLine(scriptContext) {}
        /**
         * Validation function to be executed when sublist line is inserted.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         *
         * @returns {boolean} Return true if sublist line is valid
         *
         * @since 2015.2
         */
        function validateInsert(scriptContext) {}
        /**
         * Validation function to be executed when record is deleted.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         *
         * @returns {boolean} Return true if sublist line is valid
         *
         * @since 2015.2
         */
        function validateDelete(scriptContext) {}
        /**
         * Validation function to be executed when record is saved.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @returns {boolean} Return true if record is valid
         *
         * @since 2015.2
         */
        function saveRecord(scriptContext) {
            try {
                var currentRecord = scriptContext.currentRecord;
                if (MODE == "create" || MODE == "copy") {
                    // verify if header cost center is a non-prepetition cost center
                    var costCenter = currentRecord.getValue("department");
                    var isPrePetCostCenter = verifyPrePetCostCenter(costCenter); // check if the selected cost center is a valid pre-petition cost center
                    if (isPrePetCostCenter == true) {
                        alert("The selected Cost Center is a Pre-Petition Cost Center. Please select a non-Pre-Petition Cost Center.");
                        currentRecord.setValue({
                            fieldId: "department",
                            value: "",
                            ignoreFieldChange: true
                        });
                        return false;
                    }
                    // verify if lin cost centers are non-prepetition cost centers
                    var itemCount = currentRecord.getLineCount("item");
                    if (itemCount > 0) {
                        var lineCostCenter = false;
                        for (var i = 0; i < itemCount; i++) {
                            var lineCostCenter = currentRecord.getSublistValue("item", "department", i);
                            var isPrePetCostCenter = verifyPrePetCostCenter(lineCostCenter); // check if the selected cost center is a valid pre-petition cost center
                            if (isPrePetCostCenter == true) {
                                alert("The selected Cost Center on item line is a Pre-Petition Cost Center. Please select a non-Pre-Petition Cost Center on the same.");
                                lineCostCenter = true;
                                break;
                            }
                        }
                        if (lineCostCenter == true) {
                            return false;
                        }
                    }
                }
                return true;
            } catch (e) {
                log.error("saveRecord Error", e.message);
                return true;
            }
        }
        // FUNCTION TO REJECT PURCHASE ORDER
        function rejectPO(recId) {
            try {
                var promptMsg = prompt("Please provide the reason for rejection");
                if (promptMsg === "") {
                    alert("Please click the button again and provide the reason for rejection.");
                } else if (promptMsg) {
                    record.submitFields({
                        type: "purchaseorder",
                        id: recId,
                        values: {
                            approvalstatus: '3', // set approval status to rejected
                            nextapprover: '', // set next approver to empty
							custbody_amy_reject_reason: promptMsg	// enter rejected reason message
                        },
                        options: {
                            enableSourcing: false,
                            ignoreMandatoryFields: true
                        }
                    });
                    window.location.reload();
                }
            } catch (e) {
                console.log("rejectPO Error", e.message);
            }
        }
		// FUNCTION TO REJECT PURCHASE ORDER
        function resubmitPO(recId) {
            try {
				var url = "https://5393718.app.netsuite.com/app/site/hosting/scriptlet.nl?script=5694&deploy=1&recId=" + recId;
				window.open(url,"_self");
            } catch (e) {
                console.log("resubmitPO Error", e.message);
            }
        }
		// FUNCTION TO RE-TRIGGER PO WORKFLOW
		function retriggerWF(recId) {
			try {
				var url = "https://5393718.app.netsuite.com/app/site/hosting/scriptlet.nl?script=5799&deploy=1&recId=" + recId;
				window.open(url,"_self");
			} catch (e) {
				log.error("");
			}
		}
        return {
            pageInit: pageInit,
            fieldChanged: fieldChanged,
            //postSourcing: postSourcing,
            //sublistChanged: sublistChanged,
            //lineInit: lineInit,
            //validateField: validateField,
            //validateLine: validateLine,
            //validateInsert: validateInsert,
            //validateDelete: validateDelete,
            saveRecord: saveRecord,
            rejectPO: rejectPO,
			resubmitPO: resubmitPO,
			retriggerWF: retriggerWF
        };
    });