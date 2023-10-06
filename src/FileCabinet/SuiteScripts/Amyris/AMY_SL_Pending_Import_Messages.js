/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * Version		Date					Remarks
 * 1.0		129h September, 2022		Suitelet form to process fulfillment respones.
 */
define(['N/ui/serverWidget', 'N/search', 'N/runtime', 'N/task', 'N/redirect'],
    function(ui, search, runtime, task, redirect) {
        /**
         * Definition of the Suitelet script trigger point.
         *
         * @param {Object} context
         * @param {ServerRequest} context.request - Encapsulation of the incoming request
         * @param {ServerResponse} context.response - Encapsulation of the Suitelet response
         * @Since 2015.2
         */
        function onRequest(context) {
            try {
                if (context.request.method === 'GET') { // GET METHOD TO "GET FORM DATA"
                    var scriptObj = runtime.getCurrentScript(); // Get Script Parameters
                    //var clientScriptID = scriptObj.getParameter('custscript_amy_attached_client_script'); // get client script file ID
                    var form = ui.createForm({ // create new form for "Process Fulfillment Response"
                        title: 'Pending ACB Import Messages'
                    });
                    //form.clientScriptFileId = clientScriptID; // client script attached to suitelet form for "form validations" (496321)
                    // ADD ORDER LIST RANGE FIELD GROUP
                    var primaryFilterGroup = form.addFieldGroup({
                        id: 'primary_filter_group',
                        label: 'Primary Filters'
                    });
                    // ADD "FILTER" FIELDS
                    var fromDate = createWidgetField(form, 'custpage_from_date', ui.FieldType.DATE, 'From Date', null, 'primary_filter_group'); // From Date
                    var toDate = createWidgetField(form, 'custpage_to_date', ui.FieldType.DATE, 'To Date', null, 'primary_filter_group'); // To Date
                    var brand = createWidgetField(form, 'custpage_brand', ui.FieldType.MULTISELECT, 'Brand', 'class', 'primary_filter_group'); // To Date
                    populateBrands(brand); // function to populate brands
                    // INLINE HTML (TO PROVIDE DISCLAIMER ==> YELLOW HIGHLIGHTED ON SUITELET PAGE)
                    var discInline = createWidgetField(form, 'custpage_order_disclaimer', ui.FieldType.INLINEHTML, 'Disclaimer', null, null);
                    var discText = constructInlineText(); // construct inline text
                    discInline.defaultValue = discText;
                    // SET FIELD HELP TEXT
                    fromDate.setHelpText("Select the date from which you would want to filter sales orders on or before this date.");
                    toDate.setHelpText("Select the date from which you would want to filter sales orders on or after this date.");
                    // SET FIELD MANDATORY
                    fromDate.isMandatory = true;
                    toDate.isMandatory = true;
                    // CHECK IF EXISTING SCRIPT IS PROCESSING
                    //var bulkUpdateInProgress = verifyExistingBulkUpdate();
                    // INLINE HTML END
                    form.addSubmitButton({ // "Download Shipping Labels" Button
                        label: 'Process ACB Messages'
                    });
                    context.response.writePage(form);
                } else { // POST METHOD TO "RECEIVE FORM DATA AND CONSTRUCT THE CSV FILE"
                    log.debug("Form Submitted");
                    var fromDate = context.request.parameters.custpage_from_date; // get from date
                    var toDate = context.request.parameters.custpage_to_date; // get from date
                    var brand = context.request.parameters.custpage_brand; // get brand
                    // add the above form values to an object and send it over to the Map Reduce Script
                    var filters = new Object();
                    filters["fromDate"] = fromDate;
                    filters["toDate"] = toDate;
                    filters["brand"] = brand;
                    //filters = JSON.stringify(filters);
                    log.debug('onRequest - filters: ', filters);
                    var searchCount = getSearchCount(fromDate, toDate, brand); // function to get search count
                    log.audit('onRequest - searchCount: ' + searchCount);
                    if (searchCount > 0) {
                        // trigger map reduce script
                        var mrTask = task.create({
                            taskType: task.TaskType.MAP_REDUCE
                        });
                        mrTask.scriptId = "customscript_amy_mr_int_message_process";
                        mrTask.deploymentId = "customdeploy_amy_mr_int_message_process";
                        mrTask.params = {
                            'custscript_amy_pim_filter_object': JSON.stringify(filters),
                        };
                        var mrTaskId = mrTask.submit(); 
                        // redirect to backend (Result) suitelet
                        redirect.toSuitelet({
                            scriptId: 'customscript_amy_sl_pending_imp_msg_res',
                            deploymentId: 'customdeploy_amy_sl_pending_imp_msg_res',
                            parameters: {
                                'custscript_amy_pim_search_count': searchCount,
                                'custscript_amy_sl_pim_filter_object': JSON.stringify(filters)
                            }
                        }); 
                    } else {
                        var htmlContent = constructHTMLData();
                        context.response.write(htmlContent);
                    }
                }
            } catch (e) {
                log.error('onRequest Error', e.message);
            }
        }
        // FUNCTION TO GET SEARCH COUNT
        function getSearchCount(fDate, tDate, brand) {
            try {
                // load "AMY Pending Import Messages" saved search
                var acbSearch = search.load({
                    id: 'customsearch_acb_pending_import_messages'
                });
                var filter = acbSearch.filterExpression; // Retrieve filters of the search
                if (fDate != undefined && fDate != null && fDate != '') {
                    var fDateFilter = ['created', 'onorafter', fDate];
                    filter.push('AND');
                    filter.push(fDateFilter);
                }
                if (tDate != undefined && tDate != null && tDate != '') {
                    var tDateFilter = ['created', 'onorbefore', tDate];
                    filter.push('AND');
                    filter.push(tDateFilter);
                }
                if (brand != undefined && brand != null && brand != '') {
                    brand = brand.replace(/[^\w\s]/gi, ',');
                    log.debug('brand', brand);
                    brand = brand.split(",");
                    filter.push('AND'); // add And filter to the search
                    var multiBrand = [];
                    for (var i = 0; i < brand.length; i++) {
                        if (brand.length == 1) { // if only one brand is selected
                            var brandFilter = ['custrecord_aim_data', 'contains', '\"class\": ' + brand[i] + ','];
                            filter.push(brandFilter);
                        } else if (brand.length > 1) { // if more than one brand is selected
                            if (i == 0) { // first brand filter
                                var firstbrandFilter = ['custrecord_aim_data', 'contains', '\"class\": ' + brand[i] + ','];
                                multiBrand.push(firstbrandFilter);
                                multiBrand.push('OR');
                                log.debug('First Brand Filter');
                            } else if (i == brand.length - 1) { // if last filter
                                var lastbrandFilter = ['custrecord_aim_data', 'contains', '\"class\": ' + brand[i] + ','];
                                multiBrand.push(lastbrandFilter);
                                log.debug('Last Brand Filter');
                            } else { // in case of any mid filters
                                var brandFilter = ['custrecord_aim_data', 'contains', '\"class\": ' + brand[i] + ','];
                                multiBrand.push(brandFilter);
                                multiBrand.push('OR');
                                log.debug('Mid Brand Filter');
                            }
                        }
                    };
                    if (multiBrand.length > 0) {
                        filter.push(multiBrand);
                    }
                }
                var revisedAcBSearch = search.create({
                    type: 'customrecord_acb_integration_message',
                    filters: filter
                });
                var searchResultCount = revisedAcBSearch.runPaged().count;
                return searchResultCount;
            } catch (e) {
                log.error('getSearchCount Error', e.message);
            }
        }
        // FUNCTION TO POPULATE BRANDS
        function populateBrands(brand) {
            try {
                var brandSearch = search.create({
                    type: "classification",
                    filters: [],
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            label: "Internal ID"
                        }),
                        search.createColumn({
                            name: "name",
                            sort: search.Sort.ASC,
                            label: "Name"
                        })
                    ]
                });
                var searchResultCount = brandSearch.runPaged().count;
                log.debug("classificationSearchObj result count", searchResultCount);
                if (searchResultCount > 0) {
                    brandSearch.run().each(function(result) {
                        brand.addSelectOption({
                            value: result.getValue('internalid'),
                            text: result.getValue('name')
                        });
                        return true;
                    });
                }
            } catch (e) {
                log.error('populateBrands Error', e.message);
            }
        }
        // FUNCTION TO ADD SUBLIST COLUMN (LINE) FIELD
        function createWidgetField(fieldSource, lineFieldId, lineFieldType, lineFieldLabel, lineFieldSource, containerGroup) {
            try {
                return fieldSource.addField({
                    id: lineFieldId,
                    type: lineFieldType,
                    label: lineFieldLabel,
                    source: lineFieldSource,
                    container: containerGroup
                });
            } catch (e) {
                log.error('createWidgetField Error', e.message);
            }
        }
        // FUNCTION TO CONSTRUCT APPROPRIATE DATE FORMAT
        function constructDate(date) {
            try {
                date = new Date(date);
                var dd = date.getDate();
                var mm = date.getMonth() + 1;
                var yyyy = date.getFullYear();
                return mm + "-" + dd + "-" + yyyy;
            } catch (e) {
                log.error('constructDate Error', e.message);
            }
        }
        // FUNCTION TO VERIFY IF BULK UPDATE IS IN PROGRESS
        function verifyExistingBulkUpdate() {
            try {
                var bulkUpdateInProgress = false;
                var scheduledscriptinstanceSearchObj = search.create({
                    type: "scheduledscriptinstance",
                    filters: [
                        ["status", "anyof", "PENDING", "PROCESSING"],
                        "AND",
                        ["script.scriptid", "is", "customscript_ym_sch_adspub_gross_spend"],
                        "AND",
                        ["scriptdeployment.script", "anyof", "2144"]
                    ],
                    columns: [
                        search.createColumn({
                            name: "status",
                            label: "Status"
                        }),
                        search.createColumn({
                            name: "internalid",
                            join: "script",
                            label: "Internal ID"
                        })
                    ]
                });
                var searchResultCount = scheduledscriptinstanceSearchObj.runPaged().count;
                if (searchResultCount > 0) {
                    bulkUpdateInProgress = true;
                }
                return bulkUpdateInProgress;
            } catch (e) {
                log.error('verifyExistingBulkUpdate Error', e.message);
            }
        }
        // FUNCTION TO CONSTRUCT INLINE TEXT
        function constructInlineText() {
            try {
                var strText = "";
                strText += "<script>";
                strText += "var div = document.createElement('div');";
                strText += "div.style.border = '1.5px solid #ffd480';";
                strText += "div.style.fontSize = '85%';";
                strText += "div.style.fontWeight = 'bold';";
                strText += "div.style.paddingTop = '0.2%';";
                strText += "div.style.paddingBottom = '0.2%';";
                strText += "div.style.paddingLeft = '0.2%';";
                strText += "div.style.marginBottom = '0.5%';";
                strText += "div.style.backgroundColor = '#ffffe6';";
                strText += "div.style.color = '#e62e00';";
                // Add Paras
                strText += "var p3 = document.createElement('p');";
                strText += "p3.innerHTML = 'DISCLAIMER:';";
                strText += "p3.style.fontSize = '150%';";
                strText += "p3.style.textDecoration = 'underline';";
                strText += "div.appendChild(p3);";
                strText += "var p2 = document.createElement('p');";
                strText += "p2.style.fontSize = '130%';";
                strText += "p2.innerHTML = 'Please select the From and To Dates to filter ACB Import Messages by its Created Date.';";
                strText += "div.appendChild(p2);";
                // Add Paras end
                strText += "var body = document.getElementById('div__body');";
                strText += "body.insertBefore(div, body.childNodes[0]);";
                strText += "</script>";
                return strText;
            } catch (e) {
                log.error('constructInlineText Error', e.message);
            }
        }
        // FUNCTION TO CONSTRUCT HTML DATA (FOR REGULAR SCREEN)
        function constructHTMLData() {
            try {
                var htmlStr = "";
                htmlStr += "<!DOCTYPE html>";
                htmlStr += "<html>";
                htmlStr += "	<head>";
                htmlStr += "		<title>Backend Search Count<\/title>";
                htmlStr += "	<\/head>";
                htmlStr += "	<body>";
                htmlStr += "<p>";
                htmlStr += "	No Records To Process. <\/br><\/br>";
                htmlStr += "	<button type=\"button\" style=\"cursor: pointer;\" onclick=\"window.open('https://5393718.app.netsuite.com/app/center/card.nl?sc=-29&whence=','_self');\">OK<\/button>";
                htmlStr += "<\/p>";
                htmlStr += "	<\/body>";
                htmlStr += "<\/html>";
                return htmlStr;
            } catch (e) {
                log.error('constructHTMLData Error', e.message);
            }
        }
        return {
            onRequest: onRequest
        };
    });