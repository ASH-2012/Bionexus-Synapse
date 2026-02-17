import time
import random
import requests # pip install requests

# Config
API_URL = "http://localhost:8000/ingest"

def simulate_bioreactor():
    print("Starting BioNexus Dummy Device...")
    while True:
        # Fake Sensor Data
        payload = {
            "device_id": "REACTOR_01",
            "temp": round(random.uniform(36.5, 37.5), 2),
            "turbidity": round(random.uniform(0.1, 0.9), 2),
            "ph": round(random.uniform(6.8, 7.2), 2)
        }
        
        try:
            response = requests.post(API_URL, json=payload)
            print(f"Sent: {payload} | Response: {response.status_code}")
        except Exception as e:
            print(f"Connection Error: {e}")
            
        time.sleep(2) # Send data every 2 seconds

if __name__ == "__main__":
    simulate_bioreactor()