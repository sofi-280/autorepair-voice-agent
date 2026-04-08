/**
 * Daily.co REST API helpers for the dashboard.
 * Used to create browser call rooms and issue user tokens.
 */

const DAILY_API_BASE = "https://api.daily.co/v1";

function headers() {
  return {
    Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function expTs(minutes: number) {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

export async function createBrowserCallRoom(sessionId: string) {
  const roomName = `autorepair-browser-${sessionId.slice(0, 12)}`;

  // Create room
  const roomRes = await fetch(`${DAILY_API_BASE}/rooms`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: roomName,
      properties: {
        enable_prejoin_ui: false,
        start_video_off: true,
        exp: expTs(60),
      },
    }),
  });

  if (!roomRes.ok && roomRes.status !== 409) {
    throw new Error(`Daily room creation failed: ${roomRes.status}`);
  }

  // User token
  const tokenRes = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        is_owner: false,
        exp: expTs(60),
        user_name: "Caller",
      },
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Daily token creation failed: ${tokenRes.status}`);
  }

  const { token } = await tokenRes.json();
  const domain = process.env.DAILY_DOMAIN ?? "";
  const roomUrl = `https://${domain}.daily.co/${roomName}`;

  return { roomName, roomUrl, userToken: token, sessionId };
}
