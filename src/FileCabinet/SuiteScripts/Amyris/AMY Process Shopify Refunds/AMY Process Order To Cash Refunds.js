/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([
	'N/search',
	'N/record',
	'N/url',
	'N/runtime',
	'./AMY Process Refund Helper',
	'./Constants'
], function (search, record, url, runtime, HELPER, CONSTANTS) {

	const { DEFAULT_ITEMS } = CONSTANTS;
	const { TRANSACTION_FIELDS, TRANSACTION_COLUMNS } = CONSTANTS;
	const { TRANSAFORM_REC_OBJECTS, ORDER_ADJUSTMENTS_KINDS, RESTOCK_TYPES } = CONSTANTS;
	const { ORDER_STATUS } = CONSTANTS;

	var refundDataCancel = {};
	var refundDataReturn = {};

	const stringToFloat = (str) => parseFloat(str) || 0;
	const round = (num, places = 2) => Math.round(num * 10 ** places) / 10 ** places;

	const matchRefundLinesToOrder = (refundLines, order, type) => {
		var isQtyMatch = true;
		for (let line of refundLines) {
			var orderLineNumber = order.findSublistLineWithValue({
				sublistId: 'item',
				fieldId: 'custcol_amy_ecom_line_id',
				value: line.line_item_id
			});

			if (orderLineNumber) {
				order.selectLine({ sublistId: 'item', line: orderLineNumber })
				// only handle non-bundle lines
				var isStandaloneItem = '' == order.getCurrentSublistValue({
					sublistId: 'item',
					fieldId: 'custcol_amyris_custgrpprice'
				});

				var quantityOrdered = order.getCurrentSublistValue({
					sublistId: 'item',
					fieldId: 'quantity'
				});

				var item = order.getCurrentSublistValue({
					sublistId: 'item',
					fieldId: 'item'
				});
				var itemType = order.getCurrentSublistValue({
					sublistId: 'item',
					fieldId: 'itemtype'
				});

				if (itemType === 'Group') {
					orderLineNumber = orderLineNumber + 1;
					order.selectLine({ sublistId: 'item', line: orderLineNumber })
					var quantityShipped = order.getCurrentSublistValue({
						sublistId: 'item',
						fieldId: 'quantityfulfilled'
					});
				} else {
					var quantityShipped = order.getCurrentSublistValue({
						sublistId: 'item',
						fieldId: 'quantityfulfilled'
					});
				}


				var quantityRemaining = quantityOrdered - quantityShipped;

				var sku = order.getCurrentSublistValue({
					sublistId: 'item',
					fieldId: 'item_display'
				});

				log.debug('order line properties', {
					isStandaloneItem: isStandaloneItem,
					quantityRemaining: quantityRemaining,
					sku: sku
				})

				if (type === 'Billed') {
					if (line.line_item.sku.includes('GIFTCARD') || line.line_item.sku === 'ROUND UP ADVANCED DONATION') {
						if (quantityRemaining < line.quantity) {
							throw new Error('Quantity mismtach for cancellation');
						}
					} else {
						log.debug('quantityShipped', quantityShipped)
						if (line.quantity > quantityShipped) {
							throw new Error('Quantity mismtach for return');
						}
					}

				}
				if (type === 'Pending') {
					if (quantityRemaining < line.quantity) {
						throw new Error('Quantity mismtach for cancellation');
					}
				}
			}
		}
		return isQtyMatch;
	}

	const processRefunds = (order, bodyFieldValues) => {
		var custRefundId = null;

		log.debug('refundDataCancel', refundDataCancel)
		log.debug('refundDataReturn', refundDataReturn)

		if (hasPendingFulfillmentResponse(order.id)) {
			throw new Error('Order has been queued for fulfillment');
		}
		var refundAmt = 0;
		var refundDiscAmt = 0;
		if (refundDataCancel.refund_line_items) {
			matchRefundLinesToOrder(refundDataCancel.refund_line_items, order, 'Pending')
			refundAmt = reduceOrCloselUnfulfilledLines(refundDataCancel.refund_line_items, order);
			adjustTaxAndPriceOnCancellation(refundDataCancel.refund_line_items, order);
		}
		if (refundDataCancel.order_adjustments) {
			refundDiscAmt = addDiscrepancyAsDiscount(refundDataCancel.order_adjustments, order);
		}

		HELPER.addDiscrepancyItemForShopifyBug(refundDataCancel, order);

		const totalRefundAmt = refundAmt || 0 + parseFloat(refundDiscAmt || 0);
		log.debug('totalRefundAmt', { totalRefundAmt })
		if (totalRefundAmt) {
			refundDataCancel.transactions.forEach((tranObj) => {
				custRefundId = refundDeposit(tranObj, totalRefundAmt, bodyFieldValues, true);
				log.debug('custRefundId', { custRefundId })
			});
		}
		if (custRefundId) {
			order.save(); // moving save here, if customer refund not found adusment in SO, should not save
		}
		if (refundDataReturn.refund_line_items) {
			matchRefundLinesToOrder(refundDataReturn.refund_line_items, order, 'Billed');
		}

		return refundBilledOrder(bodyFieldValues.recId, refundDataReturn, order.id, true);
	}

	const seprateOrderAdjustments = (order_adjustments) => {
		refundDataCancel.order_adjustments = order_adjustments.filter(adj => adj.kind !== ORDER_ADJUSTMENTS_KINDS.SHIPPING_REFUND);
		refundDataReturn.order_adjustments = order_adjustments.filter(adj => adj.kind === ORDER_ADJUSTMENTS_KINDS.SHIPPING_REFUND);

		let order_adjustment_total_cancel = refundDataCancel.order_adjustments.reduce(
			(amount, tran) => amount -= (parseFloat(tran.amount) + parseFloat(tran.tax_amount)), 0) || 0;

		let order_adjustment_total_return = refundDataReturn.order_adjustments.reduce(
			(amount, tran) => amount -= (parseFloat(tran.amount) + parseFloat(tran.tax_amount)), 0) || 0;
		return order_adjustment_total_return;
	}

	const setDeafultValuesToRefundData = (refundData) => {
		const { otherrefnum, created_at, id, note, order_id, processed_at, restock, class: nsClass } = refundData;
		refundDataCancel = {
			otherrefnum: otherrefnum,
			created_at: created_at,
			id: id,
			note: note,
			order_id: order_id,
			processed_at: processed_at,
			restock: restock,
			class: nsClass,
		}

		refundDataReturn = {
			otherrefnum: otherrefnum,
			created_at: created_at,
			id: id,
			note: note,
			order_id: order_id,
			processed_at: processed_at,
			restock: restock,
			class: nsClass,
		}

	}

	const seprateRefundObjects = (refundData, obj, tran_total) => {
		const { refund_line_items, order_adjustments, transactions } = refundData;
		const { otherrefnum, created_at, id, note, order_id, processed_at, restock, class: nsClass } = refundData;

		setDeafultValuesToRefundData(refundData);
		// remove GIFT-CARD items and Rounding items
		var refund_line_items_cancel = refund_line_items.filter(item =>
			!item.line_item.sku.includes('GIFTCARD') && item.line_item.sku !== 'ROUND UP ADVANCED DONATION' &&
			item.line_item.restock_type !== RESTOCK_TYPES.RETURN);

		const refund_line_total_cancel = refund_line_items_cancel.reduce(
			(amount, tran) => amount += (parseFloat(tran.subtotal) + parseFloat(tran.total_tax)), 0);

		var refund_line_items_retun = refund_line_items.filter(item =>
			item.line_item.sku.includes('GIFTCARD') || item.line_item.sku === 'ROUND UP ADVANCED DONATION' ||
			item.line_item.restock_type === RESTOCK_TYPES.RETURN);

		const refund_line_total_return = refund_line_items_retun.reduce(
			(amount, tran) => amount += (parseFloat(tran.subtotal) + parseFloat(tran.total_tax)), 0);

		refundDataCancel.refund_line_items = refund_line_items_cancel;
		refundDataReturn.refund_line_items = refund_line_items_retun;
		if (order_adjustments) {
			var order_adjustment_total_return = seprateOrderAdjustments(order_adjustments);
		}

		const return_total = refund_line_total_return + order_adjustment_total_return;
		let cancel_transactions = refundData.transactions.filter(trans => {
			trans.amount = (tran_total - return_total).toFixed(2);
			return trans;
		});

		refundDataCancel.transactions = cancel_transactions;

		const cancel_total = parseFloat(refundDataCancel.transactions[0].amount);

		let return_transactions = obj.transactions.filter(trans => {
			trans.amount = (tran_total - cancel_total).toFixed(2);
			return trans;
		});

		refundDataReturn.transactions = return_transactions;
	}

	const preValidations = (refundData, isReturnMagic) => {
		const { refund_line_items, order_adjustments, transactions } = refundData;
		// If multiple transaction objects found
		if (transactions.length > 1) {
			throw new Error('Multiple transaction objects are found');
		}

		// When Only refund discrepancy is refunded, in this case unable to determine the refund process type
		if (!refund_line_items && order_adjustments) {
			if (order_adjustments.every((adj) => adj.kind === ORDER_ADJUSTMENTS_KINDS.REFUND_DISCREPANCY)) {
				throw new Error('Only refund discrepancy is refunded');
			}
		}

		if (!isReturnMagic && refund_line_items) {
			// When shopify mixing the restock types

			//==============================================*****===================================================
			// keep this off for now; if active, this will not process the refunds in which items which are already fulfilled i.e.
			// gift cards, donation round ups.
			//==============================================*****===================================================

			// if (new Set(refund_line_items.map((refund) => refund.restock_type)).size > 1) {
			// 	throw 'Multiple restock_types found in refund object';
			// }


			// when no_restock value for restock type in any item
			if (refund_line_items.some((refund) => refund.restock_type === RESTOCK_TYPES.NO_RESTOCK)) {
				throw new Error('NO_RESTOCK restock_types found in refund object');
			}
		}

	}

	// Refund for Partially Fulfilled Sales Orders
	const refundPartiallyFulfilledOrder = (recId, refundData, order) => {
		const { note, created_at, refund_line_items, order_adjustments, transactions } = refundData;
		var refundIntId = null;

		let obj = JSON.parse(JSON.stringify(refundData));

		const tran_total = transactions.reduce(
			(amount, tran) => amount += parseFloat(tran.amount), 0);

		const refundNote = note ? note : '';
		const bodyFieldValues = {
			recId: recId,
			refundNote: refundNote,
			shopifyDate: created_at
		};
		const isReturnMagic = refundNote.includes('Refunded via Return Magic');

		preValidations(refundData, isReturnMagic);
		log.debug(`preValidations passed`);

		if (order_adjustments) {
			var hasShippingDiscrepancy = order_adjustments.some(adj => adj.kind === ORDER_ADJUSTMENTS_KINDS.SHIPPING_REFUND);
			var hasOnlyShippingDiscrepancy = order_adjustments.every(adj => adj.kind === ORDER_ADJUSTMENTS_KINDS.SHIPPING_REFUND);
		}

		if (!refund_line_items && order_adjustments) {
			if (hasOnlyShippingDiscrepancy) {
				log.debug('Processing Refund for refundPartiallyFulfilledOrder only shipping');
				refundIntId = refundBilledOrder(recId, refundData, order.id);
			} else {
				log.debug('Processing Refund for refundPartiallyFulfilledOrder shipping and refund discrepancy only');
				setDeafultValuesToRefundData(refundData);
				const return_amount = seprateOrderAdjustments(order_adjustments);
				let cancel_transactions = refundData.transactions.filter(trans => {
					trans.amount = (tran_total - return_amount).toFixed(2);
					return trans;
				});

				refundDataCancel.transactions = cancel_transactions;
				const cancel_total = parseFloat(refundDataCancel.transactions[0].amount);

				let return_transactions = obj.transactions.filter(trans => {
					trans.amount = (tran_total - cancel_total).toFixed(2);
					return trans;
				});
				refundDataReturn.transactions = return_transactions;
				refundIntId = processRefunds(order, bodyFieldValues)
			}
		}

		if (refund_line_items) {
			var isEveryReturn = refund_line_items.every((refund) => refund.restock_type === RESTOCK_TYPES.RETURN);
			var isEveryCancel = refund_line_items.every((refund) => refund.restock_type === RESTOCK_TYPES.CANCEL);
			var hasGiftOrRoundUpItems = refund_line_items.some(item =>
				item.line_item.sku.includes('GIFTCARD') || item.line_item.sku === 'ROUND UP ADVANCED DONATION');

			if (isEveryReturn || isReturnMagic) {
				matchRefundLinesToOrder(refund_line_items, order, 'Billed');
				log.debug('Processing Refund for refundPartiallyFulfilledOrder only return');
				refundIntId = refundBilledOrder(recId, refundData, order.id);
			} else if (isEveryCancel && !hasShippingDiscrepancy && !hasGiftOrRoundUpItems) {
				matchRefundLinesToOrder(refund_line_items, order, 'Pending');
				log.debug('Processing Refund for refundPartiallyFulfilledOrder only cancel');
				refundIntId = refundPendingFulfillmentOrder(recId, refundData, order);
			} else {
				log.debug('Processing Refund for refundPartiallyFulfilledOrder both');
				seprateRefundObjects(refundData, obj, tran_total);
				refundIntId = processRefunds(order, bodyFieldValues)
			}
		}

		return refundIntId;
	}


	const hasPendingFulfillmentResponse = (orderId) => {
		var found = false;

		search.create({
			type: 'customrecord_amy_fulfillment_response',
			filters: [
				['custrecord_afr_status', 'anyof', ['1', '7']],
				'and',
				['custrecord_afr_order', 'is', orderId]
			]
		}).run().each(function (result) {
			found = true;
		});

		return found;
	}

	const searchCustomerDeposit = (transaction) => {
		var depositId = null;
		const depositExternalId = 'SHOPIFY-TRANSACTION-' + transaction.parent_id;
		const columns = [
			search.createColumn({
				name: 'internalid',
				summary: search.Summary.GROUP
			}),
			search.createColumn({
				name: 'fxamount',
				summary: search.Summary.MAX
			}),
			search.createColumn({
				name: 'formulacurrency',
				summary: search.Summary.SUM,
				formula: 'ABS({applyingtransaction.fxamount})'
			})
		];

		let depositSearchResult;

		search.create({
			type: 'customerdeposit',
			filters: ['externalid', 'is', depositExternalId],
			columns: columns
		}).run().each(function (result) {
			depositSearchResult = result;
		});

		if (depositSearchResult) {
			depositId = depositSearchResult.getValue(columns[0]);
			const depositAmount = parseFloat(depositSearchResult.getValue(columns[1])) || 0;
			const totalApplied = parseFloat(depositSearchResult.getValue(columns[2])) || 0;

			const availableToRefund = round(depositAmount - totalApplied);

			log.debug('available to refund', availableToRefund);

			// deposit must have at least the refund amount unapplied
			if (availableToRefund < stringToFloat(transaction.amount)) {
				throw new Error("deposit / refund mismatch");
			}
		} else {
			//throw "can't refund non-existent deposit";
		}
		return depositId;
	}

	const refundDeposit = (transaction, amountToCancel, values, isPartial = false) => {
		const custRefId = HELPER.searchCustomerRefundByExtId(transaction.id.toString()); //searchCustomerRefund(paymentmethod, recId);
		if (custRefId) {
			log.debug('customer refund already exist', custRefId)
			return custRefId;
		}
		const depositId = searchCustomerDeposit(transaction);
		const { recId, refundNote, shopifyDate } = values;
		if (depositId) {
			const refund = record.transform({
				fromType: 'customerdeposit',
				fromId: depositId,
				toType: 'customerrefund'
			});

			HELPER.updateACBRefundIdAndMemo(refund, recId, refundNote, shopifyDate);
			refund.setValue('custbody_amy_ecom_payment_id', transaction.gateway == 'shopify_payments' || transaction.gateway == 'gift_card' ? transaction.id.toString() : transaction.authorization);
			refund.setValue('custbody_amy_disbursement_report', '');
			refund.setValue('externalid', transaction.id.toString());
			if (isPartial) {
				refund.setValue('custbody_amy_partial_customer_refund', true);
			}

			// NetSuite amount to equal Shopify amount
			refund.setSublistValue({
				sublistId: 'deposit',
				fieldId: 'amount',
				line: 0,
				value: transaction.amount
			});

			return refund.save();
		}
	}


	const removeAllLines = (record) => {

		const lineCount = record.getLineCount({ sublistId: 'item' });
		const line = 0;
		for (let i = 0; i < lineCount; i++) {
			let itemType = record.getSublistValue({
				sublistId: 'item',
				fieldId: 'itemtype',
				line
			});
			log.debug('AMY Process Order To Cash Refund => removeAllLines', { itemType });
			if (itemType !== "EndGroup") {
				log.debug('AMY Process Order To Cash Refund => removeAllLines', { removeLine: i });
				record.removeLine({
					sublistId: 'item',
					line,
				});
			}
		}
	}

	const removeLines = (record) => {
		const lineCount = record.getLineCount({ sublistId: 'item' });
		for (let i = lineCount - 1; i >= 0; i--) {
			record.selectLine({ sublistId: 'item', line: i });
			var isStandaloneItem = '' == record.getCurrentSublistValue({
				sublistId: 'item',
				fieldId: 'custcol_amyris_custgrpprice',
			});
			var itemType = record.getCurrentSublistValue({
				sublistId: 'item',
				fieldId: 'itemtype',
			});
			if (itemType == 'Group' || ((itemType == 'Assembly' || itemType == 'InvtPart' || itemType == 'OthCharge') && isStandaloneItem)) {
				record.removeLine({
					sublistId: 'item',
					line: i,
				});
			}

		}
	}

	// Refund Billed Sales Orders
	const refundBilledOrder = (recId, refundData, orderId, isPartial = false) => {

		const { SALES_ORDER } = TRANSAFORM_REC_OBJECTS
		return HELPER.processRefundForTransaction(recId, refundData, orderId, SALES_ORDER, isPartial);
	}

	const closeOrReduceLineQty = (tranRec, line, refundQty) => {
		// to fix this-> https://biossance.atlassian.net/browse/NET-504
		// var tranRec = record.load({ type: record.Type.SALES_ORDER, id: orderRec.id, isDynamic: true });
		tranRec.selectLine({ sublistId: 'item', line: line });
		// const sublistId = 'item';
		// const fieldId = 'quantity';

		var itemType = tranRec.getCurrentSublistValue({
			sublistId: 'item',
			fieldId: 'itemtype'
		});

		log.debug('itemType', itemType)

		const lineQty = tranRec.getCurrentSublistValue({
			sublistId: 'item',
			fieldId: 'quantity'
		}); //getCancelableQuantity(tranRec, line, qty);

		//							5						3										5			-		3		=> 2
		//							3						4						3											=> 0
		//							2						2										2			-		2		=> 0				
		const newQty = lineQty < refundQty ? 0 : lineQty - refundQty;
		log.debug('closeOrReduceQty', { lineQty, refundQty, newQty })

		tranRec.setCurrentSublistValue({
			sublistId: 'item',
			fieldId: 'quantity',
			value: newQty
		});

		if (newQty === 0 && itemType !== 'Group') {
			tranRec.setCurrentSublistValue({
				sublistId: 'item',
				fieldId: 'isclosed',
				value: true
			});
			// tranRec.setCurrentSublistValue({
			// 	sublistId: 'item',
			// 	fieldId: 'custcol_amy_ecom_tax',
			// 	value: 0
			// });

			// tranRec.setCurrentSublistValue({
			// 	sublistId: 'item',
			// 	fieldId: 'taxrate1',
			// 	value: 0
			// });
			// tranRec.setCurrentSublistValue({
			// 	sublistId: 'item',
			// 	fieldId: 'custcol_amy_ecom_tax_rate',
			// 	value: 0
			// });
		}
		tranRec.commitLine({ sublistId: 'item' });

		if (itemType === "Group") {
			line = line + 1; // moving to comp lines
			tranRec.selectLine({ sublistId: 'item', line: line });
			while (itemType != "EndGroup") {

				const compLineQty = tranRec.getCurrentSublistValue({
					sublistId: 'item',
					fieldId: 'quantity'
				});
				const baseCompQty = compLineQty / lineQty;
				const compRefundQty = baseCompQty * refundQty;

				const compNewQty = compLineQty < compRefundQty ? 0 : compLineQty - compRefundQty;

				log.debug(`closeOrReduceQtyLineLevel`, { compLineQty, baseCompQty, compRefundQty, compNewQty });


				tranRec.setCurrentSublistValue({
					sublistId: 'item',
					fieldId: 'quantity',
					value: compNewQty
				});
				log.debug('compNewQty', compNewQty)
				if (compNewQty === 0) {

					tranRec.setCurrentSublistValue({
						sublistId: 'item',
						fieldId: 'isclosed',
						value: true
					});

					// tranRec.setCurrentSublistValue({
					// 	sublistId: 'item',
					// 	fieldId: 'custcol_amy_ecom_tax',
					// 	value: 0
					// });
					// tranRec.setCurrentSublistValue({
					// 	sublistId: 'item',
					// 	fieldId: 'taxrate1',
					// 	value: 0
					// });

					// tranRec.setCurrentSublistValue({
					// 	sublistId: 'item',
					// 	fieldId: 'custcol_amy_ecom_tax_rate',
					// 	value: 0
					// });

				}
				tranRec.commitLine({ sublistId: 'item' });
				line = line + 1;
				tranRec.selectLine({ sublistId: 'item', line: line });
				itemType = tranRec.getCurrentSublistValue({
					sublistId: 'item',
					fieldId: 'itemtype'
				});
			}
		}

	}

	const addDiscrepancyAsDiscount = (order_adjustments, order) => {

		const { REFUND_DISCREPANCY } = ORDER_ADJUSTMENTS_KINDS;
		const { REFUND_DISCREPANCY_DISC } = DEFAULT_ITEMS;
		const refundDiscrAmt = HELPER.getTransactionsTotal(order_adjustments, REFUND_DISCREPANCY);

		if (!refundDiscrAmt || refundDiscrAmt < 0) {
			return 0;
		}

		log.debug('addDiscrepancyAsDiscount', { refundDiscrAmt })

		const lineCount = order.getLineCount({ sublistId: 'item' });
		log.debug('addDiscrepancyAsDiscount', { lineCount })

		const lineValues = {
			item: REFUND_DISCREPANCY_DISC,
			price: -1,
			quantity: 1,
			amount: -Math.abs(refundDiscrAmt)
		};

		log.debug('addDiscrepancyAsDiscount', { lineValues })


		// HELPER.addItemLine(order, lineValues, null, lineCount);
		HELPER.addDynamicItemLine(order, lineValues);

		return refundDiscrAmt;
	}

	const alterShippingCostAndUpdateTaxRate = (order_adjustments, order) => {

		const { SHIPPING_REFUND } = ORDER_ADJUSTMENTS_KINDS;
		const shipRefundAmt = HELPER.getTransactionsTotal(order_adjustments, SHIPPING_REFUND);

		log.debug('alterShippingCostAndUpdateTaxRate', { shipRefundAmt })

		if (!shipRefundAmt) {
			log.debug('alterShippingCostAndUpdateTaxRate', 'return');

			return 0;
		}

		const shippingcost = order.getValue({ fieldId: 'shippingcost' });
		order.setValue({ fieldId: 'shippingcost', value: shippingcost - Math.abs(shipRefundAmt) });

		if (shipRefundAmt > 0 && shipRefundAmt < shippingcost) {
			const shippingtax1amt = order.getValue({ fieldId: 'shippingtax1amt' });
			log.debug('shippingtax1amt', shippingtax1amt);
			let newShipAmount = shippingcost - Math.abs(shipRefundAmt);
			log.debug('newShipAmount', newShipAmount);
			let tax_amount = order_adjustments.reduce(
				(amount, adjObj) => amount -= adjObj.kind === SHIPPING_REFUND ? parseFloat(adjObj.tax_amount) : 0, 0);
			log.debug('tax_amount', tax_amount);
			let newShiptaxRate = ((parseFloat(shippingtax1amt) + (-parseFloat(tax_amount))) / parseFloat(newShipAmount)) * 100;
			log.debug('newShiptaxRate', round(newShiptaxRate, 4));
			order.setValue({ fieldId: 'shippingtax1rate', value: round(newShiptaxRate, 4) });
		}

		log.debug('alterShippingCost', { shipRefundAmt })

		return shipRefundAmt;
	}

	const updateTaxFields = (rec, line, total_tax) => {
		const ecomTaxAmt = rec.getCurrentSublistValue({
			sublistId: 'item',
			fieldId: 'custcol_amy_ecom_tax',
			line: line
		});
		const compEcomTaxAmt = stringToFloat(ecomTaxAmt) - stringToFloat(total_tax);

		rec.setCurrentSublistValue({
			sublistId: 'item',
			fieldId: 'custcol_amy_ecom_tax',
			value: compEcomTaxAmt > -1 ? compEcomTaxAmt : ecomTaxAmt,
			line: line
		});

		rec.setCurrentSublistValue({
			sublistId: 'item',
			fieldId: 'taxrate1',
			value: '',
			line: line
		});
		rec.commitLine({ sublistId: 'item' });
	}

	const adjustTaxAndPriceOnCancellation = (refund_line_items, rec) => {
		log.debug(`adjustTaxAndPriceOnCancellation`, refund_line_items);
		const { ECOM_LINE_ID } = TRANSACTION_COLUMNS;
		if (refund_line_items && refund_line_items.length > 0) {
			refund_line_items.forEach((item) => {
				const { line_item_id, quantity, subtotal, total_tax } = item;
				var line = rec.findSublistLineWithValue({
					sublistId: 'item',
					fieldId: ECOM_LINE_ID,
					value: line_item_id
				});
				log.debug(`adjustTaxAndPriceOnCancellation Line`, line);
				if (line > -1) {
					rec.selectLine({ sublistId: 'item', line: line });
					const lineQty = rec.getCurrentSublistValue({
						sublistId: 'item',
						fieldId: 'quantity'
					});
					log.debug(`adjustTaxAndPriceOnCancellation lineQty`, lineQty);
					//if (lineQty > 0) {
					var itemType = rec.getCurrentSublistValue({
						sublistId: 'item',
						fieldId: 'itemtype'
					});
					var isStandaloneItem = '' == rec.getCurrentSublistValue({
						sublistId: 'item',
						fieldId: 'custcol_amyris_custgrpprice'
					});

					log.debug(`adjustTaxAndPriceOnCancellation isStandaloneItem`, isStandaloneItem);
					if (isStandaloneItem) {
						updateTaxFields(rec, line, total_tax)
					}
					log.debug('itemType adjustTaxAndPriceOnCancellation', itemType)
					if (itemType === "Group") {
						var dontCommitLineForZeroAmountBundle = true;
						const compLineAmt = rec.getCurrentSublistValue({
							sublistId: 'item',
							fieldId: 'custcol_amyris_custgrpprice'
						});
						dontCommitLineForZeroAmountBundle = compLineAmt == "" ? false : true;
						const compNewAmt = stringToFloat(compLineAmt) - stringToFloat(subtotal);
						log.debug('compNewAmt', { new: compNewAmt, old: compLineAmt });

						rec.setCurrentSublistValue({
							sublistId: 'item',
							fieldId: 'custcol_amyris_custgrpprice',
							value: compNewAmt > -1 ? compNewAmt : compLineAmt
						});
						//updateTaxFields(rec, line, total_tax)
						const ecomTaxAmt = rec.getCurrentSublistValue({
							sublistId: 'item',
							fieldId: 'custcol_amy_ecom_tax'
						});
						dontCommitLineForZeroAmountBundle = ecomTaxAmt == "" ? false : true;
						const compEcomTaxAmt = stringToFloat(ecomTaxAmt) - stringToFloat(total_tax);
						log.debug('compEcomTaxAmt', { new: compEcomTaxAmt, old: ecomTaxAmt });

						rec.setCurrentSublistValue({
							sublistId: 'item',
							fieldId: 'custcol_amy_ecom_tax',
							value: compEcomTaxAmt > -1 ? compEcomTaxAmt : ecomTaxAmt
						});
						if (dontCommitLineForZeroAmountBundle) {
							rec.commitLine({ sublistId: 'item' });
						}
						line = line + 1; // moving to comp lines
						rec.selectLine({ sublistId: 'item', line: line });
						while (itemType != "EndGroup") {

							rec.setCurrentSublistValue({
								sublistId: 'item',
								fieldId: 'taxrate1',
								value: ''
							});
							rec.commitLine({ sublistId: 'item' });
							line = line + 1;
							rec.selectLine({ sublistId: 'item', line: line });
							itemType = rec.getCurrentSublistValue({
								sublistId: 'item',
								fieldId: 'itemtype'
							});
						}
					}
					//}
				}

			});
		}
	}

	const reduceOrCloselUnfulfilledLines = (refund_line_items, order) => {
		let refundAmt = 0;
		const { ECOM_LINE_ID } = TRANSACTION_COLUMNS;

		if (refund_line_items && refund_line_items.length > 0) {
			refund_line_items.forEach((item) => {
				const { line_item_id, quantity, subtotal, total_tax } = item;
				const line = order.findSublistLineWithValue({
					sublistId: 'item',
					fieldId: ECOM_LINE_ID,
					value: line_item_id
				});

				log.debug(`reduceOrCloselUnfulfilledLines`, { line_item_id, line });

				if (line > -1) {

					closeOrReduceLineQty(order, line, quantity)

					let amount = parseFloat(subtotal) + parseFloat(total_tax);
					refundAmt = refundAmt + round(parseFloat(amount), 2);
				}
			});
		}

		return refundAmt;
	}

	// Refund Pending Fulfillment Sales Orders
	const refundPendingFulfillmentOrder = (recId, refundData, order) => {
		var custRefundId = null;
		const { note, refund_line_items, order_adjustments, transactions, created_at } = refundData;

		log.debug(`refundPendingFulfillmentOrder`, refund_line_items);
		const refundNote = note ? note : '';
		if (hasPendingFulfillmentResponse(order.id)) {
			throw new Error('Order has been queued for fulfillment');
		}
		const refundAmt = reduceOrCloselUnfulfilledLines(refund_line_items, order);
		adjustTaxAndPriceOnCancellation(refund_line_items, order);
		const shipRefundAmt = alterShippingCostAndUpdateTaxRate(order_adjustments, order);
		log.debug('refundPendingFulfillmentOrder', { shipRefundAmt });
		const refundDiscAmt = addDiscrepancyAsDiscount(order_adjustments, order);
		HELPER.addDiscrepancyItemForShopifyBug(refundData, order);

		const bodyFieldValues = {
			recId: recId,
			refundNote: refundNote,
			shopifyDate: created_at
		};

		const totalRefundAmt = refundAmt + parseFloat(shipRefundAmt || 0) + parseFloat(refundDiscAmt || 0);
		log.debug('totalRefundAmt', { totalRefundAmt })
		if (totalRefundAmt) {
			transactions.forEach((tranObj) => {
				custRefundId = refundDeposit(tranObj, totalRefundAmt, bodyFieldValues);
				log.debug('custRefundId', { custRefundId })
			});
		}
		if (custRefundId) {
			var oId = order.save(); // moving save here, if customer refund not found adusment in SO, should not save

			var orderRecordObj = record.load({ type: record.Type.SALES_ORDER, id: oId });

			const lineCount = orderRecordObj.getLineCount({ sublistId: 'item' });
			for (let i = 0; i < lineCount; i++) {
				let itemType = orderRecordObj.getSublistValue({
					sublistId: 'item',
					fieldId: 'itemtype',
					line: i
				});
				let quantity = orderRecordObj.getSublistValue({
					sublistId: 'item',
					fieldId: 'quantity',
					line: i
				});

				log.debug('AMY Process Order To Cash Refund => closing group lines with qty 0', { itemType });
				if (itemType == "Group" && quantity == '0') {
					log.debug('AMY Process Order To Cash Refund => close bundle line', { 'line': i });
					let quantity = orderRecordObj.setSublistValue({
						sublistId: 'item',
						fieldId: 'isclosed',
						value: true,
						line: i
					});
				}
			}

			orderRecordObj.save();




		}
		return custRefundId;
	}

	const process = (recId, RefundData) => {
		const logTitle = `AMY Process Order To Cash Refunds => process`;
		let refundIntId = null;
		let refundExtId = null;
		let error = null;
		let { otherrefnum, class: nsClass, nexus } = RefundData;
		let { status } = TRANSACTION_FIELDS;
		let { PENDING_FULFILLMENT, PENDING_APPROVAL, BILLED, PARTIALLY_FULFILLED } = ORDER_STATUS;
		let orderStatus = "";
		try {

			if (!RefundData) {
				throw new Error('No refund data.');
			}
			refundExtId = RefundData.id.toString();

			const orderId = HELPER.searchSalesOrder(otherrefnum, nsClass, nexus);
			if (!orderId) {
				throw new Error(`Order does not exists: ${otherrefnum}`);
			}
			const orderRec = record.load({ type: record.Type.SALES_ORDER, id: orderId, isDynamic: true });
			orderStatus = orderRec.getValue({
				fieldId: status
			});

			log.debug(logTitle, { orderStatus });

			if (orderStatus === PENDING_FULFILLMENT || orderStatus === PENDING_APPROVAL) {
				log.debug(logTitle, 'Processing Refund for Pending Fulfillment SO');
				refundIntId = refundPendingFulfillmentOrder(recId, RefundData, orderRec);
			}
			else if (orderStatus === BILLED) {
				log.debug(logTitle, 'Processing Refund for Billed SO');
				refundIntId = refundBilledOrder(recId, RefundData, orderId);
			}
			else if (orderStatus === PARTIALLY_FULFILLED) {
				log.debug(logTitle, 'Processing Refund for Partially Fulfilled SO');
				refundIntId = refundPartiallyFulfilledOrder(recId, RefundData, orderRec);
			}
			else {
				throw new Error(`Order status: ${orderStatus} is currently not handled in the script`);
			}
		}
		catch (e) {
			refundIntId = '0'
			error = e;
			log.error(logTitle, e);
		}
		if (refundIntId) {
			HELPER.updateRefundImportMsg(recId, refundIntId, refundExtId, error);
		}

	}

	return {
		process
	}
});