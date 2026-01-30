"""Script to trigger data collection for MIkeishiring."""
import httpx
import asyncio

async def collect():
    async with httpx.AsyncClient(timeout=120.0) as client:
        print("Testing server health...")
        try:
            resp = await client.get("http://127.0.0.1:8000/")
            print(f"Health check: {resp.json()}")
        except Exception as e:
            print(f"Health check failed: {e}")
            return

        print("\nStarting collection for MIkeishiring...")
        try:
            resp = await client.post(
                "http://127.0.0.1:8000/collect",
                json={"username": "MIkeishiring"}
            )
            print(f"Collection result: {resp.json()}")
        except Exception as e:
            print(f"Collection failed: {e}")

if __name__ == "__main__":
    asyncio.run(collect())
