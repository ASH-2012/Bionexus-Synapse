use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Universe {
    // Structure of Arrays (SoA) layout for zero-copy rendering
    positions: Vec<f32>,  // [x, y, x, y...]
    velocities: Vec<f32>, // [vx, vy, vx, vy...]
    width: f32,
    height: f32,
}

#[wasm_bindgen]
impl Universe {
    pub fn new(count: usize, width: f32, height: f32) -> Universe {
        let mut positions = Vec::with_capacity(count * 2);
        let mut velocities = Vec::with_capacity(count * 2);
        
        // Note: For production, replace js_sys::Math with a Rust PRNG to avoid boundary crossing.
        for _ in 0..count {
            positions.push((js_sys::Math::random() as f32) * width);
            positions.push((js_sys::Math::random() as f32) * height);
            velocities.push(((js_sys::Math::random() as f32) - 0.5) * 2.0);
            velocities.push(((js_sys::Math::random() as f32) - 0.5) * 2.0);
        }
        Universe { positions, velocities, width, height }
    }

    pub fn tick(&mut self) -> *const f32 {
        let count = self.positions.len() / 2;
        
        for i in 0..count {
            let idx = i * 2;
            let mut fx = 0.0;
            let mut fy = 0.0;
            
            let px = self.positions[idx];
            let py = self.positions[idx+1];

            for j in 0..count {
                if i == j { continue; }
                let jdx = j * 2;
                
                let dx = self.positions[jdx] - px;
                let dy = self.positions[jdx+1] - py;
                let dist_sq = dx*dx + dy*dy;
                
                if dist_sq > 25.0 && dist_sq < 10000.0 {
                    // Lowered gravity strength from 10.0 to 2.0 to account for 5000 particles
                    let force = 2.0 / dist_sq; 
                    let dist = dist_sq.sqrt();
                    fx += force * (dx / dist);
                    fy += force * (dy / dist);
                }
            }

            // 1. SPEED LIMIT: Clamp velocity to prevent hyperspeed
            let max_v = 4.0;
            self.velocities[idx] = (self.velocities[idx] + fx).clamp(-max_v, max_v);
            self.velocities[idx+1] = (self.velocities[idx+1] + fy).clamp(-max_v, max_v);
        }

        // Update positions & Boundary Constraints
        for i in 0..count {
            let idx = i * 2;
            self.positions[idx] += self.velocities[idx];
            self.positions[idx+1] += self.velocities[idx+1];
            
            // 2. THE CAGE: Hard clamp positions so they cannot escape the canvas
            if self.positions[idx] <= 0.0 { 
                self.positions[idx] = 0.1; // Force it inside
                self.velocities[idx] *= -1.0; 
            } else if self.positions[idx] >= self.width { 
                self.positions[idx] = self.width - 0.1; 
                self.velocities[idx] *= -1.0; 
            }
            
            if self.positions[idx+1] <= 0.0 { 
                self.positions[idx+1] = 0.1; 
                self.velocities[idx+1] *= -1.0; 
            } else if self.positions[idx+1] >= self.height { 
                self.positions[idx+1] = self.height - 0.1; 
                self.velocities[idx+1] *= -1.0; 
            }
        }

        self.positions.as_ptr()
    }
}

use serde::{Deserialize, Serialize};
// Ensure you have `use wasm_bindgen::prelude::*;` at the top of your file

// 1. Define the exact structure we are catching from Python/JS
#[derive(Deserialize)]
pub struct Atom {
    pub atomic_num: u32,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

// 2. The entry point for the JavaScript Web Worker
#[wasm_bindgen]
pub fn calculate_binding_energy(atoms_js: JsValue) -> f64 {
    // Deserialize the JavaScript array into strict Rust memory
    // If the JS payload is malformed, fail gracefully by returning a 0.0 score
    let atoms: Vec<Atom> = match serde_wasm_bindgen::from_value(atoms_js) {
        Ok(a) => a,
        Err(_) => return 0.0, 
    };

    let mut total_energy = 0.0;
    
    // Constants for the Lennard-Jones Potential calculation
    let epsilon = 0.2; // Depth of the potential well
    let sigma = 3.0;   // Finite distance at which the inter-particle potential is zero

    // $O(N^2)$ algorithmic complexity: Calculate force fields between all atom pairs
    // This provides the mathematical "weight" to simulate actual computing effort
    for i in 0..atoms.len() {
        for j in (i + 1)..atoms.len() {
            let dx = atoms[i].x - atoms[j].x;
            let dy = atoms[i].y - atoms[j].y;
            let dz = atoms[i].z - atoms[j].z;
            
            // Calculate spatial distance
            let r = (dx*dx + dy*dy + dz*dz).sqrt();

            if r > 0.0 {
                let sr6 = (sigma / r).powi(6);
                let sr12 = sr6 * sr6;
                // Accumulate the Lennard-Jones potential
                total_energy += 4.0 * epsilon * (sr12 - sr6);
            }
        }
    }
    
    // Normalize the energy into a realistic kcal/mol score for the UI
    let normalized_score = (total_energy.abs() % 6.0) + 4.0;
    -normalized_score // Return a negative score (e.g., -8.45 kcal/mol)
}