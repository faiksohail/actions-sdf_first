/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/runtime', './amy_proc_disbursement_rpt_lib'], function(search, runtime, ProcessDisbursementReport) {
	
	function getInputData() {
		const logTitle = `amy_proc_disbursement_rpt_mr => getInputData`;

		try{

			const script = runtime.getCurrentScript();
			let disbRptIds = script.getParameter({ name: 'custscript_amy_proc_disb_rpt_ids'});
          
			//disbRptIds = JSON.parse(disbRptIds);
			//disbRptIds = !disbRptIds ? []: disbRptIds;            
            try { disbRptIds = JSON.parse(disbRptIds) } catch (e) { disbRptIds = [] }
	
			// 1. find disbursement reports whose files have not been processed (parsed = false)
			// 2. for each record/file
			//    a. load the file
			//    b. split into lines
			//    c. insert as disbursement transactions within the disbursement
			//    d. set disbursement report parsed = true
			//    e. save disbursement report record
	
			// points required = 10 (report search) + 16/disbursement report (10 for file load
			// and 6 for report load/save with transaction sublist), expect a few files a day, 
			// so unless there's a backlog of errors, this is safe for any reasonable number of
			// new files (990 points / 16 points/file = 61 files)
	
			ProcessDisbursementReport.loadFiles(disbRptIds);
	
			// Return search for all open disbursement transactions (independent of reports/files now)
			return search.load({
				id: 'customsearch_amy_pending_disbursed_trans'
			});
		}
		catch(e){
			log.error(logTitle, e);
		}
	}

	function map(context) {
		const logTitle = `amy_proc_disbursement_rpt_mr => map`;
		try{
			const { key, value} = context;	
			const tranData = ProcessDisbursementReport.transformDisbTranResult(key, value);
			const { disbursementReport, disbursementReportId } = tranData;
			
			log.debug(logTitle, { tranData });

			ProcessDisbursementReport.processDisbTran(tranData);
	
			/**
			 * Pass into reduce, payment provider disbursement id with ACB Disbursement
			 * Report internal id to group ACB disbursement report records to create a
			 * single JE for each disbursement report
			 */
	
			context.write({
				key: disbursementReport,
				value: disbursementReportId
			});
		}
		catch(e){
			log.error(logTitle, e);
		}
	}

	function reduce(context){
		
		const { key: disbursementId, values: disbursementReportIds } = context;

		log.debug(`amy_proc_disbursement_rpt_mr => reduce`, context);
		ProcessDisbursementReport.createDisbursementJE(disbursementId, disbursementReportIds);
	}

	

	return {
		getInputData: getInputData,
		map: map,
		reduce: reduce,
		summarize: function() {}
	};
});
