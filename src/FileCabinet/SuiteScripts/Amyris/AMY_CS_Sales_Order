/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope Public
 * Version		Date					Remarks
 * 1.0			28th November, 2022		Set Default Cost Center based on the Brand selected (field changed) 
 * 1.1			4th December, 2022		Set Delivery Term to "DDP" and Ship Method to "Royal Mail" if the subsidiary is AUK1 and Order Type is "B2B".
 * 1.2		    1st May, 2023		    Calculate Ordered Quantity variance.
 * 1.3			30th May, 2023			Set Original Quantity Ordered on Page Load (only in edit mode) 
 * 2.0			26th July, 2023			pageInit - Carrier/Service Level updates
 * 3.0          4th August, 2023		(validateLine) - To have 855 Rejected Reason required when the Line Item Rejected checkbox is true
 */
define(['N/search', 'N/format'],
    function(search, format) {
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
        var AUK_SUBSIDIARY = 8; // "Amyris UK Trading Limited (AUK1)" subsidiary
        var AMY_B2B_JVM_FORM = 198; // "AMY | Sales Order (B2B) JVN |EMEA" Form
        var AMY_B2B_ROSE_FORM = 199; // "AMY | Sales Order (B2B) Rose |EMEA" Form
        var AMY_B2B_BIO_FORM = 197; // "AMY | Sales Order (B2B) BIO |EMEA" Form
        var JVN_CLASS = 105; // "JVN" Class
        var BIO_CLASS = 1; // "Biossance" Class
        var ROSE_CLASS = 103; // "CBC - Rose" Class 
        function pageInit(scriptContext) {
            try {
                var currentRecord = scriptContext.currentRecord;
                var mode = scriptContext.mode;
                MODE = scriptContext.mode;
                if (mode == "edit") {
                    setOriginalQtyOrdered(currentRecord); // function to set original quantity ordered

                    // version 2.0 start
                    var queryString = window.location.search;
                    var urlParams = new URLSearchParams(queryString);
                    var updateCarrier = urlParams.get('updateCarrier');
                    if (updateCarrier != undefined && updateCarrier != null && updateCarrier != "" && updateCarrier == "T") {
                        currentRecord.getField({
                            fieldId: 'custbody_amy_carrier_code'
                        }).isDisabled = false; // set carrier code field type to normal
                        currentRecord.getField({
                            fieldId: 'custbody_amy_carrier_code_upd_reason'
                        }).isDisabled = false; // set carrier code update reason field type to normal
                        currentRecord.getField({
                            fieldId: 'custbody_amy_carrier_code_upd_reason'
                        }).isMandatory = true; // set carrier code update reason mandatory
                        currentRecord.getField({
                            fieldId: 'custbody_amy_brand_planner'
                        }).isMandatory = true; // set brand planner mandatory
                    }
                    var updateService = urlParams.get('updateService');
                    if (updateService != undefined && updateService != null && updateService != "" && updateService == "T") {
                        currentRecord.getField({
                            fieldId: 'custbody_amy_service_level'
                        }).isDisabled = false; // set service level field type to normal
                        currentRecord.getField({
                            fieldId: 'custbody_amy_service_level_upd_reason'
                        }).isDisabled = false; // set service level update reason field type to normal
                        currentRecord.getField({
                            fieldId: 'custbody_amy_service_level_upd_reason'
                        }).isMandatory = true; // set service level update reason mandatory
                    }
                    // version 2.0 end
                }
            } catch (e) {
                log.error('pageInit Error: ', e.message);
            }
        }
        // FUNCTION TO SET ORIGINAL QUANTITY ORDERED
        function setOriginalQtyOrdered(currentRecord) {
            try {
                debugger;
                var itemCount = currentRecord.getLineCount('item'); // get item line count
                if (itemCount > 0) {
                    for (var i = 0; i < itemCount; i++) {
                        var qtyOrd = currentRecord.getSublistValue('item', 'quantity', i); // get quantity ordered
                        var origQty = currentRecord.getSublistValue('item', 'custcol_amy_original_quantity_ordered', i); // get original quantity ordered
                        if (origQty == undefined || origQty == null || origQty == '') {
                            currentRecord.selectLine('item', i);
                            currentRecord.setCurrentSublistValue({ // set original qty value to ordered qty
                                sublistId: 'item',
                                fieldId: 'custcol_amy_original_quantity_ordered',
                                value: qtyOrd,
                                ignoreFieldChange: true
                            });
                            currentRecord.commitLine('item');
                            log.debug('setOriginalQtyOrdered Line Value Set: ' + qtyOrd);
                        }
                    }
                }
            } catch (e) {
                log.error('setOriginalQtyOrdered Error', e.message);
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
                var currentRecord = scriptContext.currentRecord; // get current record object
                var custForm = currentRecord.getValue('customform');
                var fieldId = scriptContext.fieldId; // field name                               
                if (fieldId == "class") { // if "Clas" has been changed
                    var subsidiary = currentRecord.getValue('subsidiary');
                    var className = currentRecord.getValue('class');
                    if (custForm != undefined && custForm != null && custForm != '' && subsidiary != undefined && subsidiary != null && subsidiary != '') {
                        if (subsidiary == AUK_SUBSIDIARY) { // if Subsidiary is "Amyris UK Trading Limited (AUK1)"					
                            if (custForm == AMY_B2B_JVM_FORM || custForm == AMY_B2B_ROSE_FORM || custForm == AMY_B2B_BIO_FORM) {
                                if (className == JVN_CLASS) { // if className is "JVN)"						
                                    currentRecord.setValue('department', 291); // set department as "14442 - AUK Manufacturing | JVN"
                                    var currentRecordField = currentRecord.getField('department');
                                    currentRecordField.isDisabled = true;
                                }
                                if (className == BIO_CLASS) { // if className is "Biossance"								
                                    currentRecord.setValue('department', 289); // set department as "14042 - AUK Manufacturing | Biossance"
                                    var currentRecordField = currentRecord.getField('department');
                                    currentRecordField.isDisabled = true;
                                }
                                if (className == ROSE_CLASS) { // if className is "CBC - Rose"								
                                    currentRecord.setValue('department', 290); // set department as "14342 - AUK Manufacturing | Rose"
                                    var currentRecordField = currentRecord.getField('department');
                                    currentRecordField.isDisabled = true;
                                }
                            }
                        }
                    }
                }
                if (custForm == AMY_B2B_JVM_FORM || custForm == AMY_B2B_ROSE_FORM || custForm == AMY_B2B_BIO_FORM) {
                    if (fieldId == "subsidiary" || fieldId == "class") {
                        var subsidiary = currentRecord.getValue('subsidiary');
                        if (subsidiary != undefined && subsidiary != null && subsidiary != '') {
                            if (subsidiary == AUK_SUBSIDIARY) {
                                currentRecord.setValue('location', 431);
                            }
                        }
                    }
                    if (fieldId == 'entity' || fieldId == 'custbody_cb_order_type' || fieldId == 'subsidiary') { // if field ID is customer and subsidiary is AUK1
                        if (currentRecord.getValue('custbody_cb_order_type') == '1' && currentRecord.getValue('subsidiary') == AUK_SUBSIDIARY) { // if Order Type is B2B & subsidiary is AUK1
                            currentRecord.setValue('custpage_delivery_terms', '13'); // set Delivery Terms to DDP
                            currentRecord.setValue('custbody_amy_invoice_remittance', '1'); // set Invoice Remittance to '110166 AUK JPM 2186'
                        } else {
                            currentRecord.setValue('custpage_delivery_terms', ''); // set Delivery Terms to empty
                            currentRecord.setValue('custbody_amy_invoice_remittance', ''); // set Invoice Remittance to empty
                        }
                    }
                }
                if (fieldId == "location") {
                    var location = currentRecord.getText("location");
                    if (location.indexOf("Expeditors") > -1) {
                        alert("Please select a non-Expeditor location.");
                        currentRecord.setValue({
                            fieldId: 'location',
                            value: "",
                            ignoreFieldChange: true
                        });
                    }
                }
                if (scriptContext.sublistId == "item" && fieldId == "quantity") {
                    var itemQty = currentRecord.getCurrentSublistValue("item", "quantity");
                    if (parseFloat(itemQty) == 0) {
                        currentRecord.setCurrentSublistValue("item", "custcol_acb_li_rejected", true);
                    } else {
                        currentRecord.setCurrentSublistValue("item", "custcol_acb_li_rejected", false);
                    }
                }
            } catch (e) {
                log.error("fieldChanged Error:", e.message);
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
        function postSourcing(scriptContext) {
            try {
                var currentRecord = scriptContext.currentRecord;
                var fieldId = scriptContext.fieldId;
                var sublistId = scriptContext.sublistId;
                var custForm = currentRecord.getValue('customform');
                if (custForm == AMY_B2B_JVM_FORM || custForm == AMY_B2B_ROSE_FORM || custForm == AMY_B2B_BIO_FORM) {
                    if (sublistId == 'item' && fieldId == 'item') {
                        updateCostCenter(currentRecord); // set client article price and description
                    }
                }
            } catch (e) {
                log.error("postSourcing Error:", e.message);
            }
        }
        //FUNCTION TO UPDATE COST CENTER
        function updateCostCenter(currentRecord) {
            try {
                var costCenter = currentRecord.getValue('department');
                if (costCenter != undefined && costCenter != null && costCenter != '') {
                    currentRecord.setCurrentSublistValue('item', 'department', costCenter); // set description
                    var itemSublist = currentRecord.getSublist('item');
                    var costCenter = itemSublist.getColumn('department');
                    costCenter.isDisabled = true;
                }
            } catch (e) {
                log.error("updateCostCenter Error:", e.message);
            }
        }
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
        function validateLine(scriptContext) {
            try {
                var currentRecord = scriptContext.currentRecord;
                var orderType = currentRecord.getValue('custbody_cb_order_type'); // get order type
                var orderedQtyVariance = currentRecord.getCurrentSublistValue('item', 'custcol_amy_ordered_quantity_variance');
                var lineQty = currentRecord.getCurrentSublistValue('item', 'quantity');
                log.debug("lineQty", lineQty);
                var originalQty = currentRecord.getCurrentSublistValue('item', 'custcol_amy_original_quantity_ordered');
                var qtyVariance = parseFloat(lineQty) - parseFloat(originalQty);
                if (orderType != undefined && orderType != null && orderType != "" && orderType == "1" && MODE == "edit") { // If order type is B2B
                    if ((parseFloat(originalQty) != parseFloat(lineQty)) && qtyVariance != 0) { // if original quantity does not match line quantity
                        log.debug("Check if 855 Rejected Reason is empty");
                        debugger;
                        var rejectedReason = currentRecord.getCurrentSublistText('item', 'custcol_amy_855_reasons');
                        var lineItemRejected = currentRecord.getCurrentSublistValue('item', 'custcol_acb_li_rejected');
                        if (lineQty > 0 && (rejectedReason == undefined || rejectedReason == null || rejectedReason == "")) {
                            alert("Please provide an 855 Reasons.");
                            return false;
                        } else if ((lineQty == 0 && (rejectedReason == undefined || rejectedReason == null || rejectedReason == "" || (rejectedReason.indexOf("Rejected") < 0 && rejectedReason.indexOf("Cancelled") < 0)))) {
                            alert("Please select an Item Rejected or an Item Cancelled option in 855 Reason field.");
                            return false;

                        }
                    }
                }
                var orderedQty = currentRecord.getCurrentSublistValue('item', 'quantity'); // get ordered quantity
                var originalQty = currentRecord.getCurrentSublistValue('item', 'custcol_amy_original_quantity_ordered'); // get original quantity ordered
                if (originalQty != undefined && originalQty != null && originalQty != '' && orderedQty != undefined && orderedQty != null && orderedQty != '') {
                    var qtyVariance = parseFloat(orderedQty) - parseFloat(originalQty); // calcualte quantity variance
                    currentRecord.setCurrentSublistValue('item', 'custcol_amy_ordered_quantity_variance', qtyVariance); // set quantity variance
                }
                return true;
            } catch (ex) {
                log.debug('Validate Line Exception', ex.message);
            }
        }
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
                var orderType = currentRecord.getValue('custbody_cb_order_type'); // get order type
                if (orderType != undefined && orderType != null && orderType != "" && orderType == "1" && MODE == "edit") {
                    // Loop through each line item
                    var itemCount = currentRecord.getLineCount('item');
                    for (var i = 0; i < itemCount; i++) {
                        var lineQty = currentRecord.getSublistValue('item', 'quantity', i);
                        var originalQty = currentRecord.getSublistValue('item', 'custcol_amy_original_quantity_ordered', i);
                        var qtyVariance = parseFloat(lineQty) - parseFloat(originalQty);
                        if ((parseFloat(originalQty) != parseFloat(lineQty)) && qtyVariance != 0) { // if original quantity does not match line quantity
                            var rejectedReason = currentRecord.getSublistValue('item', 'custcol_amy_855_reasons', i);
                            var lineItemRejected = currentRecord.getSublistValue('item', 'custcol_acb_li_rejected', i);
                            if (rejectedReason == undefined || rejectedReason == null || rejectedReason == "" || lineItemRejected == false) {
                                alert("Please mark Line Item Rejected and provide an 855 Reasons for item lines having a Quantity Variance.");
                                return false;
                            }
                        }
                    }
                }

                // Continue with the default save operation
                return true;
            } catch (ex) {
                log.error('Save Record Error:', ex.message);
                return true;
            }
        }
        return {
            pageInit: pageInit,
            fieldChanged: fieldChanged,
            postSourcing: postSourcing,
            //sublistChanged: sublistChanged,
            //lineInit: lineInit,
            //validateField: validateField,
            validateLine: validateLine,
            //validateInsert: validateInsert,
            //validateDelete: validateDelete,
            //saveRecord: saveRecord
        };
    });
