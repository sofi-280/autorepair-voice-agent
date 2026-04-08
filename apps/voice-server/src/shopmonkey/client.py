"""ShopMonkey REST API client with JWT auth."""
import logging
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)


class ShopMonkeyClient:
    """Async HTTP client for the ShopMonkey v3 API."""

    def __init__(self) -> None:
        self._token: Optional[str] = None
        self._http = httpx.AsyncClient(
            base_url=settings.shopmonkey_base_url,
            timeout=15,
        )

    async def _get_token(self) -> str:
        if self._token:
            return self._token
        resp = await self._http.post(
            "/auth/login",
            json={"email": settings.shopmonkey_email, "password": settings.shopmonkey_password},
        )
        resp.raise_for_status()
        self._token = resp.json()["data"]["token"]
        return self._token

    async def _headers(self) -> dict:
        return {"Authorization": f"Bearer {await self._get_token()}"}

    # ── Customers ────────────────────────────────────────────────────────────

    async def list_customers(self, phone: str = None, search: str = None) -> list:
        params = {}
        if phone:
            params["phone"] = phone
        if search:
            params["search"] = search
        r = await self._http.get("/customer", params=params, headers=await self._headers())
        r.raise_for_status()
        return r.json().get("data", {}).get("rows", [])

    async def get_customer(self, customer_id: str) -> dict:
        r = await self._http.get(f"/customer/{customer_id}", headers=await self._headers())
        r.raise_for_status()
        return r.json().get("data", {})

    async def create_customer(self, data: dict) -> dict:
        r = await self._http.post("/customer", json=data, headers=await self._headers())
        r.raise_for_status()
        return r.json()["data"]

    async def update_customer(self, customer_id: str, data: dict) -> dict:
        r = await self._http.patch(f"/customer/{customer_id}", json=data, headers=await self._headers())
        r.raise_for_status()
        return r.json()["data"]

    # ── Vehicles ─────────────────────────────────────────────────────────────

    async def list_vehicles(self, customer_id: str = None) -> list:
        params = {}
        if customer_id:
            params["customerId"] = customer_id
        r = await self._http.get("/vehicle", params=params, headers=await self._headers())
        r.raise_for_status()
        return r.json().get("data", {}).get("rows", [])

    # ── Appointments ──────────────────────────────────────────────────────────

    async def list_appointments(self, customer_id: str = None, phone: str = None) -> list:
        params = {}
        if customer_id:
            params["customerId"] = customer_id
        if phone:
            params["phone"] = phone
        r = await self._http.get("/appointment", params=params, headers=await self._headers())
        r.raise_for_status()
        return r.json().get("data", {}).get("rows", [])

    async def create_appointment(self, data: dict) -> dict:
        r = await self._http.post("/appointment", json=data, headers=await self._headers())
        r.raise_for_status()
        return r.json()["data"]

    async def update_appointment(self, appointment_id: str, data: dict) -> dict:
        r = await self._http.patch(f"/appointment/{appointment_id}", json=data, headers=await self._headers())
        r.raise_for_status()
        return r.json()["data"]

    async def cancel_appointment(self, appointment_id: str) -> bool:
        r = await self._http.delete(f"/appointment/{appointment_id}", headers=await self._headers())
        r.raise_for_status()
        return True

    # ── Orders ────────────────────────────────────────────────────────────────

    async def list_orders(self, customer_search: str = None, status_filter: list = None) -> list:
        params = {}
        if customer_search:
            params["search"] = customer_search
        if status_filter:
            params["status"] = ",".join(status_filter)
        r = await self._http.get("/order", params=params, headers=await self._headers())
        r.raise_for_status()
        return r.json().get("data", {}).get("rows", [])

    # ── Canned Services ───────────────────────────────────────────────────────

    async def list_canned_services(self, name: str = None) -> list:
        params = {}
        if name:
            params["search"] = name
        r = await self._http.get("/canned-service", params=params, headers=await self._headers())
        r.raise_for_status()
        return r.json().get("data", {}).get("rows", [])

    async def close(self) -> None:
        await self._http.aclose()
