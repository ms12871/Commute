const path = require('node:path');
const express = require('express');
const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
require('dotenv').config();

const app = express();
const publicDirectory = path.join(__dirname, 'public');
const subwayFeeds = {
    '1': 'gtfs',
    '6': 'gtfs',
    f: 'gtfs-bdfm'
};
const apiClient = axios.create({ timeout: 10000 });

app.use(express.static(publicDirectory));

function apiKeyOrRespond(res) {
    const apiKey = process.env.MTA_API_KEY;
    if (!apiKey) {
        res.status(503).json({ error: 'MTA_API_KEY is not configured on the server.' });
        return null;
    }
    return apiKey;
}

function toUnixSeconds(value) {
    if (value && typeof value.toNumber === 'function') {
        return value.toNumber();
    }
    return Number(value);
}

function stopTimeSeconds(stopTime, preferredField) {
    const otherField = preferredField === 'departure' ? 'arrival' : 'departure';
    const value = stopTime?.[preferredField]?.time ?? stopTime?.[otherField]?.time;
    return value === undefined ? NaN : toUnixSeconds(value);
}

async function getSubwayArrivals(line, stopId, apiKey) {
    const feed = await getFeed(line, apiKey);
    const now = Math.floor(Date.now() / 1000);
    const arrivals = [];

    for (const entity of feed.entity) {
        const tripUpdate = entity.tripUpdate;
        if (!tripUpdate) continue;
        if (tripUpdate.trip?.routeId && tripUpdate.trip.routeId.toLowerCase() !== line) continue;

        for (const stopTime of tripUpdate.stopTimeUpdate || []) {
            if (stopTime.stopId !== stopId) continue;
            const arrivalTime = toUnixSeconds(stopTime.arrival?.time ?? stopTime.departure?.time);
            if (Number.isFinite(arrivalTime) && arrivalTime >= now) {
                arrivals.push(arrivalTime);
            }
        }
    }

    return [...new Set(arrivals)].sort((a, b) => a - b).slice(0, 3);
}

async function getFeed(line, apiKey) {
    const feedUrl = `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F${subwayFeeds[line]}`;
    const response = await apiClient.get(feedUrl, {
        responseType: 'arraybuffer',
        headers: { 'x-api-key': apiKey }
    });
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(response.data);
}

const routeOptions = {
    morning: [
        {
            label: 'F → 1',
            transfer: '14 St',
            transferMinutes: 5,
            legs: [
                { line: 'f', from: 'F01S', to: 'D19S', board: 'Jamaica–179 St', alight: '14 St–6 Av' },
                { line: '1', from: '130S', to: '133S', board: '14 St–7 Av', alight: 'Canal St' }
            ]
        },
        {
            label: 'F → 6',
            transfer: 'Broadway–Lafayette / Bleecker St',
            transferMinutes: 5,
            legs: [
                { line: 'f', from: 'F01S', to: 'D21S', board: 'Jamaica–179 St', alight: 'Broadway–Lafayette St' },
                { line: '6', from: '635S', to: '639S', board: 'Bleecker St', alight: 'Canal St' }
            ]
        }
    ],
    evening: [
        {
            label: '1 → F',
            transfer: '14 St',
            transferMinutes: 5,
            legs: [
                { line: '1', from: '133N', to: '130N', board: 'Canal St', alight: '14 St–7 Av' },
                { line: 'f', from: 'D19N', to: 'F01N', board: '14 St–6 Av', alight: 'Jamaica–179 St' }
            ]
        },
        {
            label: '6 → F',
            transfer: 'Broadway–Lafayette / Bleecker St',
            transferMinutes: 5,
            legs: [
                { line: '6', from: '639N', to: '635N', board: 'Canal St', alight: 'Bleecker St' },
                { line: 'f', from: 'D21N', to: 'F01N', board: 'Broadway–Lafayette St', alight: 'Jamaica–179 St' }
            ]
        }
    ]
};

function getTripLegs(feed, line, fromStopId, toStopId, now) {
    const legs = [];
    for (const entity of feed.entity) {
        const tripUpdate = entity.tripUpdate;
        const routeId = tripUpdate?.trip?.routeId;
        if (!tripUpdate || (routeId && routeId.toLowerCase() !== line)) continue;

        const stopTimes = tripUpdate.stopTimeUpdate || [];
        const fromStop = stopTimes.find((stopTime) => stopTime.stopId === fromStopId);
        const toStop = stopTimes.find((stopTime) => stopTime.stopId === toStopId);
        if (!fromStop || !toStop) continue;

        const departureTime = stopTimeSeconds(fromStop, 'departure');
        const arrivalTime = stopTimeSeconds(toStop, 'arrival');
        if (Number.isFinite(departureTime) && departureTime >= now &&
            Number.isFinite(arrivalTime) && arrivalTime > departureTime) {
            legs.push({ departureTime, arrivalTime });
        }
    }
    return legs;
}

function findFastestOption(options, feeds, now) {
    const predictions = [];
    for (const option of options) {
        const [firstLeg, secondLeg] = option.legs;
        const firstTrips = getTripLegs(feeds[firstLeg.line], firstLeg.line, firstLeg.from, firstLeg.to, now);
        const secondTrips = getTripLegs(feeds[secondLeg.line], secondLeg.line, secondLeg.from, secondLeg.to, now);
        let fastestPrediction = null;

        for (const firstTrip of firstTrips) {
            const readyTime = firstTrip.arrivalTime + option.transferMinutes * 60;
            const secondTrip = secondTrips
                .filter((trip) => trip.departureTime >= readyTime)
                .sort((a, b) => a.arrivalTime - b.arrivalTime)[0];
            if (!secondTrip) continue;

            const prediction = {
                label: option.label,
                transfer: option.transfer,
                transferMinutes: option.transferMinutes,
                departureTime: firstTrip.departureTime,
                arrivalTime: secondTrip.arrivalTime,
                durationMinutes: Math.ceil((secondTrip.arrivalTime - now) / 60),
                inTransitMinutes: Math.ceil((secondTrip.arrivalTime - firstTrip.departureTime) / 60),
                legs: [
                    { ...firstLeg, departureTime: firstTrip.departureTime, arrivalTime: firstTrip.arrivalTime },
                    { ...secondLeg, departureTime: secondTrip.departureTime, arrivalTime: secondTrip.arrivalTime }
                ]
            };
            if (!fastestPrediction || prediction.arrivalTime < fastestPrediction.arrivalTime) {
                fastestPrediction = prediction;
            }
        }
        if (fastestPrediction) predictions.push(fastestPrediction);
    }
    return predictions.sort((a, b) => a.arrivalTime - b.arrivalTime);
}

app.get('/api/routes/fastest', async (req, res) => {
    const apiKey = apiKeyOrRespond(res);
    if (!apiKey) return;

    try {
        const lines = ['f', '1', '6'];
        const feedEntries = await Promise.all(lines.map(async (line) => [line, await getFeed(line, apiKey)]));
        const feeds = Object.fromEntries(feedEntries);
        const now = Math.floor(Date.now() / 1000);
        const morning = findFastestOption(routeOptions.morning, feeds, now);
        const evening = findFastestOption(routeOptions.evening, feeds, now);
        res.set('Cache-Control', 'no-store').json({
            morning: { fastest: morning[0] || null, alternatives: morning.slice(1) },
            evening: { fastest: evening[0] || null, alternatives: evening.slice(1) }
        });
    } catch (error) {
        console.error('Fastest-route prediction failed:', error.message);
        res.status(502).json({ error: 'Unable to calculate subway routes from current MTA predictions.' });
    }
});

app.get('/api/subway/:line/:stopId', async (req, res) => {
    const { line, stopId } = req.params;
    if (!Object.hasOwn(subwayFeeds, line)) {
        res.status(400).json({ error: 'Unsupported subway line.' });
        return;
    }
    if (!/^[A-Za-z0-9]+$/.test(stopId)) {
        res.status(400).json({ error: 'Invalid subway stop ID.' });
        return;
    }

    const apiKey = apiKeyOrRespond(res);
    if (!apiKey) return;

    try {
        const times = await getSubwayArrivals(line, stopId, apiKey);
        res.set('Cache-Control', 'no-store').json({ times });
    } catch (error) {
        console.error('Subway feed request failed:', error.message);
        res.status(502).json({ error: 'Unable to retrieve subway arrivals from the MTA.' });
    }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Commute dashboard running at http://localhost:${port}`);
});
