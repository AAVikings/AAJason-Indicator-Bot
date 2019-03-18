﻿const axios = require('axios')
const auth = require('./utils/auth')

exports.newCommons = function newCommons(bot, logger, UTILITIES) {

    const FULL_LOG = true;
    const LOG_FILE_CONTENT = false;

    const MODULE_NAME = "Commons";

    const GMT_SECONDS = ':00.000 GMT+0000';

    let thisObject = {
        initializeData: initializeData,
        runSimulation: runSimulation,
        buildLRC: buildLRC,
        buildPercentageBandwidthMap: buildPercentageBandwidthMap,
        buildBollingerBandsMap: buildBollingerBandsMap,
        buildBollingerChannelsArray: buildBollingerChannelsArray,
        buildBollingerSubChannelsArray: buildBollingerSubChannelsArray,
        buildCandles: buildCandles
    };

    let utilities = UTILITIES.newCloudUtilities(bot, logger);

    let LRCMap = new Map();
    let percentageBandwidthMap = new Map();
    let bollingerBandsMap = new Map();
    let bollingerChannelsArray = [];
    let bollingerSubChannelsArray = [];

    let candles = [];

    return thisObject;

    function initializeData() {

        LRCMap = new Map();
        percentageBandwidthMap = new Map();
        bollingerBandsMap = new Map();
        bollingerChannelsArray = [];
        bollingerSubChannelsArray = [];

        candles = [];
    }

    async function runSimulation(
        recordsArray,
        conditionsArray,
        lastObjectsArray,
        simulationLogic,
        timePeriod,
        startDate,
        endDate,
        interExecutionMemory,
        callback) {

        try {

            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> Entering function."); }

            /* Initial Values */

            let initialDate = startDate;
            let initialBalanceA = 1;
            let minimunBalanceA = 0.5;

            /* Strategy and Phases */

            let strategyNumber = 0;
            let strategyPhase = 0;  // So far we will consider 5 possible phases: 0 = Initial state, 1 = Signal to buy, 2 = Buy, 3 = After Buy, 4 = Sell.

            /* Stop Loss Management */

            let stopLossPercentage = 1.5;
            let previousStopLoss = 0;
            let stopLoss = 0;
            let stopLossDecay = 0;
            let stopLossDecayIncrement = 0.06;
            let stopLossPhase = 0;

            /* Buy Order Management */

            let buyOrderPercentage = 1;
            let previousBuyOrder = 0;
            let buyOrder = 0;
            let buyOrderDecay = 0;
            let buyOrderPhase = 0;

            /* Building records */

            let record;
            let balanceAssetA = initialBalanceA;
            let balanceAssetB = 0;
            let profit = 0;
            let lastProfit = 0;
            let lastProfitPercent = 0;
            let sellRate = 0;

            let previousBalanceAssetA = 0;
            let hitRatio = 0;
            let ROI = 0;
            let days = 0;
            let anualizedRateOfReturn = 0;
            let type = '""';
            let rate = 0;
            let newStopLoss;

            let initialBuffer = 3;

            if (interExecutionMemory.roundtrips === undefined) {
                interExecutionMemory.roundtrips = 0;
            }

            if (interExecutionMemory.fails === undefined) {
                interExecutionMemory.fails = 0;
            }

            if (interExecutionMemory.hits === undefined) {
                interExecutionMemory.hits = 0;
            }

            if (interExecutionMemory.periods === undefined) {
                interExecutionMemory.periods = 0;
            }

            simulationLogic.strategies = await getStrategy();
           
            /* Main Simulation Loop: We go thourgh all the candles at this time period. */

            for (let i = 0 + initialBuffer; i < candles.length; i++) {

                /* Update all the data objects available for the simulation. */

                let candle = candles[i];
                let percentageBandwidth = percentageBandwidthMap.get(candle.begin);
                let bollingerBand = bollingerBandsMap.get(candle.begin);
                let LRC = LRCMap.get(candle.begin);

                if (LRC === undefined) { continue; }
                if (percentageBandwidth === undefined) { continue; } // percentageBandwidth might start after the first few candles.
                if (candle.begin < initialDate.valueOf()) { continue; }

                interExecutionMemory.periods++;

                let channel = getElement(bollingerChannelsArray, candle.begin, candle.end);
                let subChannel = getElement(bollingerSubChannelsArray, candle.begin, candle.end);

                let lastObjects = {
                    candle: clone(candle),
                    LRC: clone(LRC),
                    bollingerBand: clone(bollingerBand),
                    percentageBandwidth: clone(percentageBandwidth),
                    channel: clone(channel),
                    subChannel: clone(subChannel)
                }

                function clone(obj) {
                    if (null == obj || "object" != typeof obj) return obj;
                    var copy = obj.constructor();
                    for (var attr in obj) {
                        if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
                    }
                    return copy;
                }

                lastObjects.candle.previous = undefined;
                lastObjects.LRC.previous = undefined;
                lastObjects.bollingerBand.previous = undefined;
                lastObjects.percentageBandwidth.previous = undefined;
                lastObjects.channel.previous = undefined;
                lastObjects.subChannel.previous = undefined;

                lastObjectsArray.push(lastObjects);

                if (lastObjectsArray.length > 5) {
                    lastObjectsArray.splice(0,1);
                }

                let conditions = new Map;       // Here we store the conditions values that will be use in the simulator for decision making.
                let conditionsArrayRecord = []; // These are the records that will be saved in a file for the plotter to consume.
                let conditionsArrayValues = []; // Here we store the conditions values that will be written on file for the plotter.

                /* We define and evaluate all conditions to be used later during the simulation loop. */

                conditionsArrayRecord.push(candle.begin);
                conditionsArrayRecord.push(candle.end);

                for (let j = 0; j < simulationLogic.strategies.length; j++) {

                    let strategy = simulationLogic.strategies[j];

                    for (let k = 0; k < strategy.entryPoint.situations.length; k++) {

                        let situation = strategy.entryPoint.situations[k];

                        for (let m = 0; m < situation.conditions.length; m++) {

                            let condition = situation.conditions[m];
                            let key = strategy.name + '-' + situation.name + '-' + condition.name;

                            newCondition(key, condition.code);
                        }
                    }

                    for (let k = 0; k < strategy.exitPoint.situations.length; k++) {

                        let situation = strategy.exitPoint.situations[k];

                        for (let m = 0; m < situation.conditions.length; m++) {

                            let condition = situation.conditions[m];
                            let key = strategy.name + '-' + situation.name + '-' + condition.name;

                            newCondition(key, condition.code);
                        }
                    }

                    for (let k = 0; k < strategy.sellPoint.situations.length; k++) {

                        let situation = strategy.sellPoint.situations[k];

                        for (let m = 0; m < situation.conditions.length; m++) {

                            let condition = situation.conditions[m];
                            let key = strategy.name + '-' + situation.name + '-' + condition.name;

                            newCondition(key, condition.code);
                        }
                    }

                    for (let p = 0; p < strategy.stopLoss.phases.length; p++) {

                        let phase = strategy.stopLoss.phases[p];

                        for (let k = 0; k < phase.situations.length; k++) {

                            let situation = phase.situations[k];

                            for (let m = 0; m < situation.conditions.length; m++) {

                                let condition = situation.conditions[m];
                                let key = strategy.name + '-' + phase.name + '-' + situation.name + '-' + condition.name;

                                newCondition(key, condition.code);
                            }
                        }
                    }

                    for (let p = 0; p < strategy.buyOrder.phases.length; p++) {

                        let phase = strategy.buyOrder.phases[p];

                        for (let k = 0; k < phase.situations.length; k++) {

                            let situation = phase.situations[k];

                            for (let m = 0; m < situation.conditions.length; m++) {

                                let condition = situation.conditions[m];
                                let key = strategy.name + '-' + phase.name + '-' + situation.name + '-' + condition.name;

                                newCondition(key, condition.code);
                            }
                        }
                    }
                }

                function newCondition(key, code) {

                    let condition;

                    condition = {
                        key: key,
                        value: eval(code)
                    };

                    conditions.set(condition.key, condition);

                    if (condition.value) {
                        conditionsArrayValues.push(1);
                    } else {
                        conditionsArrayValues.push(0);
                    }
                }

                /* While we are outside all strategies, we evaluate whether it is time to enter one or not. */

                if (strategyNumber === 0 &&
                    balanceAssetA > minimunBalanceA) {

                    /*
                    Here we need to pick a strategy, or if there is not suitable strategy for the current
                    market conditions, we pass until the next period.
    
                    To pick a new strategy we will evaluate what we call an entering condition. Once we enter
                    into one strategy, we will ignore market conditions for others. However there is also
                    a strategy exit condition which can be hit before entering into a trade. If hit, we would
                    be outside a strategy again and looking for the condition to enter all over again.

                    */

                    checkEntryPoints();

                    function checkEntryPoints() {

                        for (let j = 0; j < simulationLogic.strategies.length; j++) {

                            let strategy = simulationLogic.strategies[j];

                            for (let k = 0; k < strategy.entryPoint.situations.length; k++) {

                                let situation = strategy.entryPoint.situations[k];
                                let passed = true;

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = strategy.name + '-' + situation.name + '-' + condition.name

                                    let value = conditions.get(key).value;

                                    if (value === false) { passed = false; }
                                }

                                if (passed) {

                                    strategyPhase = 1;
                                    strategyNumber = j + 1;

                                    return;
                                }
                            }
                        }
                    }
                }

                /* Strategy Exit Condition */

                if (strategyPhase === 1) {

                    checkExitPoints();

                    function checkExitPoints() {

                        let strategy = simulationLogic.strategies[strategyNumber - 1];

                        for (let k = 0; k < strategy.exitPoint.situations.length; k++) {

                            let situation = strategy.exitPoint.situations[k];
                            let passed = true;

                            for (let m = 0; m < situation.conditions.length; m++) {

                                let condition = situation.conditions[m];
                                let key = strategy.name + '-' + situation.name + '-' + condition.name

                                let value = conditions.get(key).value;

                                if (value === false) { passed = false; }
                            }

                            if (passed) {

                                strategyPhase = 0;
                                strategyNumber = 0;

                                return;
                            }
                        }
                    }
                }

                if (strategyPhase === 3) {

                    /* Checking what happened since the last execution. We need to know if the Stop Loss
                        or our Buy Order were hit. */

                    /* Stop Loss condition: Here we verify if the Stop Loss was hitted or not. */

                    if (candle.max >= stopLoss) {

                        balanceAssetA = balanceAssetB / stopLoss;

                        balanceAssetB = 0;
                        rate = stopLoss;
                        type = '"Buy@StopLoss"';
                        strategyPhase = 4;
                    }

                    /* Buy Order condition: Here we verify if the Buy Order was filled or not. */

                    if (candle.min <= buyOrder) {

                        balanceAssetA = balanceAssetB / buyOrder;

                        balanceAssetB = 0;
                        rate = buyOrder;
                        type = '"Buy@BuyOrder"';
                        strategyPhase = 4;
                    }
                }

                /* Strategy Sell Condition */

                if (strategyPhase === 1) {

                    checkSellPoints();

                    function checkSellPoints() {

                        let strategy = simulationLogic.strategies[strategyNumber - 1];

                        for (let k = 0; k < strategy.sellPoint.situations.length; k++) {

                            let situation = strategy.sellPoint.situations[k];
                            let passed = true;

                            for (let m = 0; m < situation.conditions.length; m++) {

                                let condition = situation.conditions[m];
                                let key = strategy.name + '-' + situation.name + '-' + condition.name

                                let value = conditions.get(key).value;

                                if (value === false) { passed = false; }
                            }

                            if (passed) {

                                type = '"Sell"';

                                strategyPhase = 2;
                                stopLossPhase = 1;
                                buyOrderPhase = 1;

                                return;
                            }
                        }
                    }
                }

                /* Stop Loss Management */

                if (strategyPhase === 3) {

                    checkStopLoss();

                    function checkStopLoss() {

                        let strategy = simulationLogic.strategies[strategyNumber - 1];

                        let phase = strategy.stopLoss.phases[stopLossPhase - 1];

                        eval(phase.code); // Here is where we apply the formula given for the stop loss for this phase.

                        if (newStopLoss < previousStopLoss) {
                            stopLoss = newStopLoss;
                        } else {
                            stopLoss = previousStopLoss;
                        }

                        for (let k = 0; k < phase.situations.length; k++) {

                            let situation = phase.situations[k];
                            let passed = true;

                            for (let m = 0; m < situation.conditions.length; m++) {

                                let condition = situation.conditions[m];
                                let key = strategy.name + '-' + phase.name + '-' + situation.name + '-' + condition.name

                                let value = conditions.get(key).value;

                                if (value === false) { passed = false; }
                            }

                            if (passed) {

                                stopLossPhase++;

                                return;
                            }
                        }
                    }
                }

                /* Buy Order Management */

                if (strategyPhase === 3) {

                    checkBuyOrder();

                    function checkBuyOrder() {

                        let strategy = simulationLogic.strategies[strategyNumber - 1];

                        let phase = strategy.buyOrder.phases[buyOrderPhase - 1];

                        eval(phase.code); // Here is where we apply the formula given for the buy order at this phase.

                        for (let k = 0; k < phase.situations.length; k++) {

                            let situation = phase.situations[k];
                            let passed = true;

                            for (let m = 0; m < situation.conditions.length; m++) {

                                let condition = situation.conditions[m];
                                let key = strategy.name + '-' + phase.name + '-' + situation.name + '-' + condition.name

                                let value = conditions.get(key).value;

                                if (value === false) { passed = false; }
                            }

                            if (passed) {

                                buyOrderPhase++;

                                return;
                            }
                        }
                    }
                }

                /* Check if we need to sell. */

                if (strategyPhase === 2) {

                    previousBalanceAssetA = balanceAssetA;
                    lastProfit = 0;
                    lastProfitPercent = 0;

                    balanceAssetB = balanceAssetA * candle.close;
                    balanceAssetA = 0;

                    rate = candle.close;
                    sellRate = rate;

                    stopLoss = sellRate + sellRate * stopLossPercentage / 100;

                    stopLossDecay = 0;

                    addRecord();

                    strategyPhase = 3;
                    continue;
                }

                /* Check if we need to buy. */

                if (strategyPhase === 4) {

                    interExecutionMemory.roundtrips++;
                    lastProfit = balanceAssetA - previousBalanceAssetA;

                    lastProfitPercent = lastProfit / previousBalanceAssetA * 100;
                    if (isNaN(lastProfitPercent)) { lastProfitPercent = 0; }

                    profit = profit + lastProfit;

                    ROI = (initialBalanceA + profit) / initialBalanceA - 1;
                    //if (isNaN(ROI)) { ROI = 0; }

                    if (lastProfit > 0) {
                        interExecutionMemory.hits++;
                    } else {
                        interExecutionMemory.fails++;
                    }
                    hitRatio = interExecutionMemory.hits / interExecutionMemory.roundtrips;

                    let miliSecondsPerDay = 24 * 60 * 60 * 1000;
                    days = interExecutionMemory.periods * timePeriod / miliSecondsPerDay;
                    anualizedRateOfReturn = ROI / days * 365;

                    addRecord();

                    strategyNumber = 0;
                    stopLoss = 0;
                    sellRate = 0;
                    buyOrder = 0;
                    strategyPhase = 0;
                    stopLossPhase = 0;
                    buyOrderPhase = 0;

                    continue;

                }

                /* Not a buy or sell condition */

                rate = candle.close;
                addRecord();

                function addRecord() {

                    record = {
                        begin: candle.begin,
                        end: candle.end,
                        type: type,
                        rate: rate,
                        amount: 1,
                        balanceA: balanceAssetA,
                        balanceB: balanceAssetB,
                        profit: profit,
                        lastProfit: lastProfit,
                        stopLoss: stopLoss,
                        roundtrips: interExecutionMemory.roundtrips,
                        hits: interExecutionMemory.hits,
                        fails: interExecutionMemory.fails,
                        hitRatio: hitRatio,
                        ROI: ROI,
                        periods: interExecutionMemory.periods,
                        days: days,
                        anualizedRateOfReturn: anualizedRateOfReturn,
                        sellRate: sellRate,
                        lastProfitPercent: lastProfitPercent,
                        strategy: strategyNumber,
                        strategyPhase: strategyPhase,
                        buyOrder: buyOrder,
                        stopLossPhase: stopLossPhase,
                        buyOrderPhase: buyOrderPhase
                    }

                    recordsArray.push(record);

                    previousStopLoss = stopLoss;

                    type = '""';

                    conditionsArrayRecord.push(strategyNumber);
                    conditionsArrayRecord.push(strategyPhase);
                    conditionsArrayRecord.push(stopLossPhase);
                    conditionsArrayRecord.push(buyOrderPhase);
                    conditionsArrayRecord.push(conditionsArrayValues);

                    conditionsArray.push(conditionsArrayRecord);

                }
            }

            callback();

            function getElement(pArray, begin, end) {

                let element;

                for (let i = 0; i < pArray.length; i++) {

                    element = pArray[i];

                    if (begin >= element.begin && end <= element.end) {
                        return element
                    }
                }

                element = {
                    direction: 'unknown',
                    slope: 'unknown'
                };
                return element;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] runSimulation -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildLRC(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildLRC -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let LRC = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    _15: dataFile[i][2],
                    _30: dataFile[i][3],
                    _60: dataFile[i][4]
                };

                if (previous !== undefined) {

                    if (previous._15 > LRC._15) { LRC.direction15 = 'down'; }
                    if (previous._15 < LRC._15) { LRC.direction15 = 'up'; }
                    if (previous._15 === LRC._15) { LRC.direction15 = 'side'; }

                    if (previous._30 > LRC._30) { LRC.direction30 = 'down'; }
                    if (previous._30 < LRC._30) { LRC.direction30 = 'up'; }
                    if (previous._30 === LRC._30) { LRC.direction30 = 'side'; }

                    if (previous._60 > LRC._60) { LRC.direction60 = 'down'; }
                    if (previous._60 < LRC._60) { LRC.direction60 = 'up'; }
                    if (previous._60 === LRC._60) { LRC.direction60 = 'side'; }

                }

                LRC.previous = previous;

                LRCMap.set(LRC.begin, LRC);

                previous = LRC;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildLRC -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildPercentageBandwidthMap(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildPercentageBandwidthMap -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let percentageBandwidth = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    value: dataFile[i][2],
                    movingAverage: dataFile[i][3],
                    bandwidth: dataFile[i][4]
                };

                if (previous !== undefined) {

                    if (previous.movingAverage > percentageBandwidth.movingAverage) { percentageBandwidth.direction = 'down'; }
                    if (previous.movingAverage < percentageBandwidth.movingAverage) { percentageBandwidth.direction = 'up'; }
                    if (previous.movingAverage === percentageBandwidth.movingAverage) { percentageBandwidth.direction = 'side'; }

                }

                percentageBandwidth.previous = previous;

                percentageBandwidthMap.set(percentageBandwidth.begin, percentageBandwidth);

                previous = percentageBandwidth;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildPercentageBandwidthMap -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildBollingerBandsMap(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildBollingerBandsMap -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let bollingerBand = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    movingAverage: dataFile[i][2],
                    standardDeviation: dataFile[i][3],
                    deviation: dataFile[i][4]
                };

                if (previous !== undefined) {

                    if (previous.movingAverage > bollingerBand.movingAverage) { bollingerBand.direction = 'down'; }
                    if (previous.movingAverage < bollingerBand.movingAverage) { bollingerBand.direction = 'up'; }
                    if (previous.movingAverage === bollingerBand.movingAverage) { bollingerBand.direction = 'side'; }

                }

                bollingerBand.previous = previous;

                bollingerBandsMap.set(bollingerBand.begin, bollingerBand);

                previous = bollingerBand;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildBollingerBandsMap -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildBollingerChannelsArray(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildBollingerChannelsArray -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let bollingerChannel = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    direction: dataFile[i][2],
                    period: dataFile[i][3],
                    firstMovingAverage: dataFile[i][4],
                    lastMovingAverage: dataFile[i][5],
                    firstDeviation: dataFile[i][6],
                    lastDeviation: dataFile[i][7]
                };

                bollingerChannel.previous = previous;

                bollingerChannelsArray.push(bollingerChannel);

                previous = bollingerChannel;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildBollingerChannelsArray -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildBollingerSubChannelsArray(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildBollingerSubChannelsArray -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let bollingerSubChannel = {
                    begin: dataFile[i][0],
                    end: dataFile[i][1],
                    direction: dataFile[i][2],
                    slope: dataFile[i][3],
                    period: dataFile[i][4],
                    firstMovingAverage: dataFile[i][5],
                    lastMovingAverage: dataFile[i][6],
                    firstDeviation: dataFile[i][7],
                    lastDeviation: dataFile[i][8]
                };

                bollingerSubChannel.previous = previous;

                bollingerSubChannelsArray.push(bollingerSubChannel);

                previous = bollingerSubChannel;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildBollingerSubChannelsArray -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    function buildCandles(dataFile, callBackFunction) {

        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] buildCandles -> Entering function."); }

        try {

            let previous;

            for (let i = 0; i < dataFile.length; i++) {

                let candle = {
                    open: undefined,
                    close: undefined,
                    min: 10000000000000,
                    max: 0,
                    begin: undefined,
                    end: undefined,
                    direction: undefined
                };

                candle.min = dataFile[i][0];
                candle.max = dataFile[i][1];

                candle.open = dataFile[i][2];
                candle.close = dataFile[i][3];

                candle.begin = dataFile[i][4];
                candle.end = dataFile[i][5];

                if (candle.open > candle.close) { candle.direction = 'down'; }
                if (candle.open < candle.close) { candle.direction = 'up'; }
                if (candle.open === candle.close) { candle.direction = 'side'; }

                candle.previous = previous;

                candles.push(candle);

                previous = candle;
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] buildCandles -> err = " + err.message);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }

    async function getStrategy() {

        try {

            const accessToken = await auth.authenticate()

            const strategizerResponse = await axios({
                url: process.env.GATEWAY_ENDPOINT,
                method: 'post',
                data: {
                    query: `
                query($fbSlug: String!){
           
                    strategizer_StrategyByFb(fbSlug: $fbSlug){
                    subStrategies{
                        name
                        entryPoint{
                        situations{
                            name
                            conditions{
                            name
                            code
                            }
                        }
                        }
                        exitPoint{
                        situations{
                            name
                            conditions{
                            name
                            code
                            }
                        }
                        }
                        sellPoint{
                        situations{
                            name
                            conditions{
                            name
                            code
                            }
                        }
                        }
                        buyPoint{
                        situations{
                            name
                            conditions{
                            name
                            code
                            }
                        }
                        }
                        stopLoss{
                        phases{
                            name
                            code
                            situations{
                            name
                            conditions{
                                name
                                code
                            }
                            }
                        }
                        }
                        buyOrder{
                        phases{
                            name
                            code
                            situations{
                            name
                            conditions{
                                name
                                code
                            }
                            }
                        }
                        }
                        sellOrder{
                        phases{
                            name
                            code
                            situations{
                            name
                            conditions{
                                name
                                code
                            }
                            }
                        }
                        }
                    }
                    }
                }
          
                `,
                    variables: {
                        fbSlug: bot.codeName
                    },
                },
                headers: {
                    authorization: 'Bearer ' + accessToken
                }
            })

            if (strategizerResponse.data.errors)
                throw new Error(strategizerResponse.data.errors[0].message)

            return strategizerResponse.data.data.strategizer_StrategyByFb.subStrategies;

        } catch (error) {
            throw new Error('There has been an error getting the strategy to run on the simulator. Error: ' + error)
        }
    }
};



