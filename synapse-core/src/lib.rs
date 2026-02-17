use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Universe {
    particles: Vec<f64>, // [x, y, vx, vy] flattened
    width: f64,
    height: f64,
}

#[wasm_bindgen]
impl Universe {
    pub fn new(count: usize, width: f64, height: f64) -> Universe {
        let mut particles = Vec::with_capacity(count * 4);
        for _ in 0..count {
            particles.push(js_sys::Math::random() * width);      // x
            particles.push(js_sys::Math::random() * height);     // y
            particles.push((js_sys::Math::random() - 0.5) * 2.0); // vx
            particles.push((js_sys::Math::random() - 0.5) * 2.0); // vy
        }
        Universe { particles, width, height }
    }

    pub fn tick(&mut self) -> *const f64 {
        let count = self.particles.len() / 4;
        
        // Simple Gravity Simulation
        for i in 0..count {
            let idx = i * 4;
            let mut fx = 0.0;
            let mut fy = 0.0;
            
            // Apply forces (simplified N-body)
            for j in 0..count {
                if i == j { continue; }
                let jdx = j * 4;
                let dx = self.particles[jdx] - self.particles[idx];
                let dy = self.particles[jdx+1] - self.particles[idx+1];
                let dist_sq = dx*dx + dy*dy;
                
                if dist_sq > 25.0 && dist_sq < 10000.0 {
                    let force = 10.0 / dist_sq;
                    let dist = dist_sq.sqrt();
                    fx += force * (dx / dist);
                    fy += force * (dy / dist);
                }
            }

            self.particles[idx+2] += fx;
            self.particles[idx+3] += fy;
        }

        // Update positions
        for i in 0..count {
            let idx = i * 4;
            self.particles[idx] += self.particles[idx+2];
            self.particles[idx+1] += self.particles[idx+3];
            
            // Boundary bounce
            if self.particles[idx] < 0.0 || self.particles[idx] > self.width { 
                self.particles[idx+2] *= -1.0; 
            }
            if self.particles[idx+1] < 0.0 || self.particles[idx+1] > self.height { 
                self.particles[idx+3] *= -1.0; 
            }
        }

        self.particles.as_ptr()
    }
}
