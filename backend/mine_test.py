import requests
import time
import random

def trigger_mining():
    url = "http://localhost:8000/ingest"
    while True:
        payload = {
            "sensor_id": "BIO_NODE_TEST",
            "temp": round(36.5 + random.uniform(-0.5, 0.5), 2),
            "ph": round(7.0 + random.uniform(-0.2, 0.2), 2),
            "timestamp": time.time()
        }
        try:
            response = requests.post(url, json=payload)
            print(f"[TEST] Injected data. Server response: {response.json().get('status')}")
        except Exception as e:
            print(f"[ERROR] Could not connect to backend: {e}")
        
        time.sleep(2) # Send data every 2 seconds to keep the grid busy

if __name__ == "__main__":
    trigger_mining()