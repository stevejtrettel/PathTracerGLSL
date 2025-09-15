# Uniform Naming (v0 fast-track)

We standardize three uniform families:

- **Module uniforms**: `u_<moduleId>_<localName>`
    - Examples: `u_camera_fovY`, `u_world_sphereCenter`, `u_tracer_sunDir`
- **System uniforms (reserved)**: `u_sys_<name>`
    - `u_sys_resolution : vec2`, `u_sys_time : float`, `u_sys_frame : int`
- **Developer channel bindings (reserved)**: `u_dev_<channel>`
    - `u_dev_radiance` (and later: `u_dev_albedo`, `u_dev_normal`, …)

The assembler prefixes module locals automatically. Modules should **declare locals** (`uniform float fovY;`) and never hardcode the prefix.
