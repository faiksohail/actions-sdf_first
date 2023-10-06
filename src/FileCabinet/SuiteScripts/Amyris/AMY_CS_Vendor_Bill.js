/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope Public
 * Version		Date					Remarks
 * 1.0			28th November, 2022		Set Default Cost Center based on the Brand selected (field changed) 
 */
define(['N/currentRecord', 'N/record'],
    function(currentRecord, record) {
        /**
         * Function to be executed after page is initialized.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.mode - The mode in which the record is being accessed (create, copy, or edit)
         *
         * @since 2015.2
         */
        function pageInit(scriptContext) {}
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
        function fieldChanged(scriptContext) {}
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
        function saveRecord(scriptContext) {}
        // FUNCTION TO REVERSE PRE-PETITION JOURNAL ENTRY
        function reversrPrePetJE(recId) {
            try {
                var promptMsg = prompt("Please provide the reason for reversal");
                if (promptMsg === "") {
                    alert("Please click the button again and provide the reason for reversal");
                } else if (promptMsg) { 
                    createLoadingDiv(); // Create loading div
					document.getElementById('outerDiv').style.display = "block";
                    document.getElementById('innerDiv').style.display = "block";
                    setTimeout(function() {
                        var curRec = currentRecord.get(); debugger;
                        // update vendor bill record
                        record.submitFields({
                            type: "vendorbill",
                            id: recId,
                            values: {
                                paymenthold: false,
                                custbody_amy_pre_reversal_je_memo: promptMsg
                            },
                            options: {
                                enableSourcing: false,
                                ignoreMandatoryFields: true
                            }
                        });
                        // set journal entry reversal date and reversal memo
                        record.submitFields({
                            type: "journalentry",
                            id: curRec.getValue("custbody_amy_prepetition_reclass_je"),
                            values: {
                                reversaldate: new Date(),
                                custbody_amy_pre_reversal_je_memo: promptMsg
                            },
                            options: {
                                enableSourcing: false,
                                ignoreMandatoryFields: true
                            }
                        });
                        window.location.reload();
                    }, 0.01);
                }
            } catch (e) {
                console.log("reversrPrePetJE Error: " + e.message);
                alert(e.message)
            }
        }
        // FUNCTION TO CREATE LOADING DIV
        function createLoadingDiv() {
            try {
                document.body.style.zIndex = "1";
                document.body.style.height = "100%";
                var outerDiv = document.createElement("div");
                outerDiv.id = "outerDiv";
                outerDiv.style.display = "none";
                outerDiv.style.width = "100%";
                outerDiv.style.height = "100%";
                outerDiv.style.position = "fixed";
                outerDiv.style.top = "0px";
                outerDiv.style.right = "0px";
                outerDiv.style.bottom = "0px";
                outerDiv.style.left = "0px";
                outerDiv.style.margin = "0px";
                outerDiv.style.backgroundColor = "black";
                outerDiv.style.opacity = "0.5";
                outerDiv.style.zIndex = "1000";
                document.body.appendChild(outerDiv);
                var innerDiv = document.createElement("div");
                innerDiv.id = "innerDiv";
                innerDiv.innerHTML = "Updating Reversal Information. Please wait for the page to refresh...";
                innerDiv.style.display = "none";
                innerDiv.style.zIndex = "1001";
                innerDiv.style.position = "fixed";
                innerDiv.style.backgroundColor = "#ddd";
                innerDiv.style.border = "2px solid black";
                innerDiv.style.marginTop = "2%";
                innerDiv.style.top = "25%";
                innerDiv.style.left = "20%";
                innerDiv.style.right = "20%";
                innerDiv.style.padding = "2%";
                innerDiv.style.fontSize = "140%";
                innerDiv.style.fontWeight = "bold";
                innerDiv.style.textAlign = "center";
                document.body.appendChild(innerDiv);
            } catch (e) {
                log.error('createLoadingDiv Error', e.message);
            }
        }
        return {
            pageInit: pageInit,
            //fieldChanged: fieldChanged,
            //postSourcing: postSourcing,
            //sublistChanged: sublistChanged,
            //lineInit: lineInit,
            //validateField: validateField,
            //validateLine: validateLine,
            //validateInsert: validateInsert,
            //validateDelete: validateDelete,
            //saveRecord: saveRecord,
            reversrPrePetJE: reversrPrePetJE
        };
    });