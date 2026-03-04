import time
import random
import json
import aiomqtt
import asyncio

# Configuration
BROKER = "localhost"
TOPIC = "bionexus/sensors/main"

async def main():
    print(f"👻 STARTING GHOST BIOREACTOR SIMULATOR...")
    print(f"📡 Connecting to MQTT Broker at {BROKER}...")
    
    async with aiomqtt.Client(BROKER) as client:
        print("✅ CONNECTED. Streaming fake sensor data...")
        
        while True:
            # Simulate realistic biology data
            # Temp fluctuates around 37.0
            temp = round(37.0 + random.uniform(-0.5, 0.5), 2)
            # pH fluctuates around 7.0
            ph = round(7.0 + random.uniform(-0.2, 0.2), 2)
            # Turbidity increases slowly (bacteria growing)
            turbidity = round(0.1 + (time.time() % 100) / 100, 2)
            
            payload = {
                "device_id": "BIO_REACT_01",
                "timestamp": time.time(),
                "temp": temp,
                "ph": ph,
                "turbidity": turbidity,
                "status": "ACTIVE"
            }
            
            # Publish to the topic your backend is listening to
            await client.publish(TOPIC, json.dumps(payload))
            
            print(f"📤 SENT: Temp={temp}°C | pH={ph} | Turbidity={turbidity}")
            await asyncio.sleep(15) # Send every 15 seconds

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Simulation Stopped.")
    except Exception as e:
        print(f"\n❌ CRITICAL ERROR: {e}")
        print("Make sure Docker is running! (docker compose up -d)") 