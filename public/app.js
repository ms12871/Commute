const REFRESH_INTERVAL_MS = 30_000;
let isRefreshing = false;

function formatTime(time) {
    return new Date(time * 1000).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
    });
}

function renderRoute(containerId, result) {
    const container = document.getElementById(containerId);
    container.replaceChildren();

    const route = result?.fastest;
    if (!route) {
        const message = document.createElement('p');
        message.className = 'status';
        message.textContent = 'No complete route prediction is available right now.';
        container.append(message);
        return;
    }

    const summary = document.createElement('div');
    summary.className = 'route-summary';
    const heading = document.createElement('h3');
    heading.textContent = `Fastest predicted: ${route.label}`;
    const timing = document.createElement('p');
    timing.className = 'route-timing';
    timing.textContent = `About ${route.durationMinutes} min from now · arrive ${formatTime(route.arrivalTime)}`;
    const rideTime = document.createElement('p');
    rideTime.className = 'route-detail';
    rideTime.textContent = `On trains and transferring: about ${route.inTransitMinutes} min`;
    summary.append(heading, timing, rideTime);
    container.append(summary);

    route.legs.forEach((leg, index) => {
        const card = document.createElement('article');
        card.className = 'transit-card';
        const badge = document.createElement('div');
        badge.className = `route-badge ${leg.line === 'f' ? 'f' : leg.line === '1' ? 'one' : 'six'}`;
        badge.textContent = leg.line.toUpperCase();
        const details = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = `${leg.board} → ${leg.alight}`;
        const time = document.createElement('p');
        time.className = 'status';
        time.textContent = `${formatTime(leg.departureTime)} departure · ${formatTime(leg.arrivalTime)} arrival`;
        details.append(title, time);
        card.append(badge, details);
        container.append(card);

        if (index < route.legs.length - 1) {
            const transfer = document.createElement('div');
            transfer.className = 'transfer-note';
            const label = document.createElement('span');
            label.className = 'transfer-label';
            label.textContent = `Transfer at ${route.transfer}`;
            const walkTime = document.createElement('p');
            walkTime.textContent = `Allow ${route.transferMinutes} minutes to change trains; the estimate includes the wait for the next train.`;
            transfer.append(label, walkTime);
            container.append(transfer);
        }
    });

    const alternative = result.alternatives?.[0];
    if (alternative) {
        const note = document.createElement('p');
        note.className = 'alternative-route';
        note.textContent = `Alternative: ${alternative.label}, about ${alternative.durationMinutes} min from now.`;
        container.append(note);
    }
}

async function updateDashboard() {
    if (isRefreshing) return;
    isRefreshing = true;
    document.getElementById('last-updated').textContent = 'Updating live routes…';
    try {
        const response = await fetch('/api/routes/fastest', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to retrieve route estimates.');
        renderRoute('morning-itinerary', data.morning);
        renderRoute('evening-itinerary', data.evening);
        document.getElementById('last-updated').textContent =
            `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (error) {
        for (const containerId of ['morning-itinerary', 'evening-itinerary']) {
            const container = document.getElementById(containerId);
            const message = document.createElement('p');
            message.className = 'status error';
            message.textContent = error.message || 'Unable to retrieve route estimates.';
            container.replaceChildren(message);
        }
        document.getElementById('last-updated').textContent = 'Route update failed';
    } finally {
        isRefreshing = false;
    }
}

updateDashboard();
setInterval(updateDashboard, REFRESH_INTERVAL_MS);
