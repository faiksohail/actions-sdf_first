/**
 * @NScriptType MapReduceScript
 * @NApiVersion 2.1
 * 
 */
define([
    'N/search', 'N/runtime', 'N/record', './Common/AMY AZR Message Submission', './Common/AMY AZR Constants'
], function(search, runtime, record, AZRMessageSubmission, Constants) {
    const LOG_TITLE = `AMY MR Send Fulfillment Request`;
    const getSoValuesToFReqMessage = (soId, values) => {
        const {
            SERVICE_BUS_CONFIG
        } = Constants.get();
        const {
            TN_FULFILLMENT_REQUESTS
        } = !SERVICE_BUS_CONFIG ? {} : SERVICE_BUS_CONFIG;
        const {
            class: {
                text: className
            },
            otherrefnum: otherrefnum,
            tranid: tranId,
            custbody_cb_order_type: {
                text: orderType
            },
            location: {
                text: location
            },
            nexus: {
                value: nexus
            }
        } = values;
        let freqMessage = {
            type: TN_FULFILLMENT_REQUESTS,
            order_id: soId, // Sales Order id
            tran_id: tranId, // Document Number / Sales Transaction Id
            location: location,
            order_number: otherrefnum, // PO/Check #
            order_type: (tranId.includes('TO') && !orderType) ? 'TO' : orderType,
            class_name: className,
            nexus: nexus
        };
        let httpHeaders = {
            'X-NS-Location': location,
            'X-NS-Class': className,
            'X-NS-Order-Type': (tranId.includes('TO') && !orderType) ? 'TO' : orderType
        }
        return [freqMessage, httpHeaders];
    }
    const getInputData = () => {
        const logTitle = `${LOG_TITLE} => getInputData`;
        try {
            var scriptObj = runtime.getCurrentScript();
            var slFilters = JSON.parse(scriptObj.getParameter('custscript_amy_sb_filter_object'));
            var fDate = slFilters.fromDate; // get from date from script parameters
            var tDate = slFilters.toDate; // get to date from script parameters
            var brand = slFilters.brand; // get brand from script parameters
            var location = slFilters.locaton; // get location from script parameters
            const soSearch = search.load({
                id: 'customsearch_amy_fulfillment_requests'
            });
            var filter = soSearch.filters; // Retrieve filters of the search
            if (fDate != undefined && fDate != null && fDate != '') {
                var fDateFilter = search.createFilter({ //create new filter
                    name: 'trandate',
                    operator: 'onorafter',
                    values: fDate
                });
                filter.push(fDateFilter);
            }
            if (tDate != undefined && tDate != null && tDate != '') {
                var tDateFilter = search.createFilter({ //create new filter
                    name: 'trandate',
                    operator: 'onorbefore',
                    values: tDate
                });
                filter.push(tDateFilter);
            }
            if (brand != undefined && brand != null && brand != '') {
                brand = brand.replace(/[^\w\s]/gi, ',');
                log.debug('brand', brand);
                brand = brand.split(",");
                var brandOptions = [];
                for (var i = 0; i < brand.length; i++) {
                    brandOptions.push(brand[i]);
                };
                var brandFilter = search.createFilter({ //create new filter
                    name: 'class',
                    operator: 'anyof',
                    values: brandOptions
                });
                filter.push(brandFilter);
            }
            if (location != undefined && location != null && location != '') {
                location = location.replace(/[^\w\s]/gi, ',');
                log.debug('location', location);
                location = location.split(",");
                var locOptions = [];
                for (var i = 0; i < location.length; i++) {
                    locOptions.push(location[i]);
                };
                var locFilter = search.createFilter({ //create new filter
                    name: 'location',
                    operator: 'anyof',
                    values: locOptions
                });
                filter.push(locFilter);
            }
            return soSearch;
        } catch (exp) {
            log.error(logTitle, exp);
        }
    }
    const map = (context) => {
        const logTitle = `${LOG_TITLE} => map`;
        try {
            const result = JSON.parse(context.value);
            const {
                id,
                values
            } = result;
            log.debug(logTitle, result);
            log.debug(logTitle, id);
            const [freqMessage, httpHeaders] = getSoValuesToFReqMessage(id, values)
            AZRMessageSubmission.sendAzureServiceBusMessage(freqMessage, httpHeaders);
        } catch (exp) {
            log.error(logTitle, exp);
        }
    }
    return {
        getInputData,
        map
    }
});