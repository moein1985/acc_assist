
// Use native fetch instead of node-fetch
async function smokeTest() {
    const INGEST_URL = process.env.ACC_TELEMETRY_INGEST_URL?.trim();
    const EVENTS_URL = process.env.ACC_TELEMETRY_EVENTS_URL?.trim();
    const BEARER_TOKEN = process.env.ACC_TELEMETRY_BEARER_TOKEN?.trim();

    if (!INGEST_URL || !EVENTS_URL) {
        throw new Error('Missing ACC_TELEMETRY_INGEST_URL or ACC_TELEMETRY_EVENTS_URL environment variable.');
    }

    if (!BEARER_TOKEN) {
        throw new Error('Missing ACC_TELEMETRY_BEARER_TOKEN environment variable.');
    }

    const testEvent = {
        id: `smoke-test-${Date.now()}`,
        timestamp: new Date().toISOString(),
        level: 'info',
        category: 'smoke-test',
        event: 'manual-trigger',
        process: 'main',
        appVersion: '1.0.0-smoke',
        platform: 'win32',
        arch: 'x64',
        message: 'This is a manual smoke test event from the development agent.'
    };

    console.log(`[1/3] Sending test event to ${INGEST_URL}...`);
    try {
        const ingestResponse = await fetch(INGEST_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${BEARER_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([testEvent])
        });

        if (!ingestResponse.ok) {
            throw new Error(`Ingest failed: ${ingestResponse.status} ${await ingestResponse.text()}`);
        }
        console.log(`[2/3] Ingest successful.`);

        console.log(`[3/3] Verifying event in collector via ${EVENTS_URL}...`);
        const eventsResponse = await fetch(`${EVENTS_URL}?limit=5`, {
            headers: { 'Authorization': `Bearer ${BEARER_TOKEN}` }
        });

        if (!eventsResponse.ok) {
            throw new Error(`Events retrieval failed: ${eventsResponse.status}`);
        }

        const data = await eventsResponse.json();
        const found = data.events.find(e => e.event?.id === testEvent.id);

        if (found) {
            console.log('✅ Smoke test PASSED: Event found in collector.');
            console.log('Details:', JSON.stringify(found, null, 2));
        } else {
            console.log('❌ Smoke test FAILED: Event NOT found in collector.');
            console.log('Last events:', JSON.stringify(data.events, null, 2));
        }
    } catch (error) {
        console.error('❌ Smoke test ERROR:', error.message);
    }
}

smokeTest();
