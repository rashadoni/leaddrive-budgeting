// Next.js Route Handler for Server-Sent Events (SSE)
// This endpoint allows the Bloomberg-style terminal to receive real-time push updates 
// without polling the database every 30 seconds.

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  // Create a TransformStream to stream data to the client
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Helper function to push messages to the client
  const sendEvent = async (event: string, data: any) => {
    try {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(message));
    } catch (e) {
      console.error('Error writing to SSE stream:', e);
    }
  };

  // 1. Send initial connection success message
  sendEvent('connected', { timestamp: new Date().toISOString() });

  // 2. Here you would typically hook into your background job queue (e.g. BullMQ events)
  // or a Pub/Sub system (Redis) to listen for "indicator_computed" events.
  // For the architectural skeleton, we will set up a heartbeat interval.
  const intervalId = setInterval(() => {
    sendEvent('heartbeat', { status: 'alive', time: new Date().toISOString() });
  }, 15000);

  // Clean up when the client disconnects
  request.signal.addEventListener('abort', () => {
    clearInterval(intervalId);
    writer.close();
  });

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
