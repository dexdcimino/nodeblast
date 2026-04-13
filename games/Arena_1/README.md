# Arena_1 — Asset Scale & Units Reference

## Units
- 1 unit = 1 meter in BabylonJS
- Export scale: 1.0 (no multiplier)
- Up axis: Y-up

## Asset Dimensions (match current procedural geometry)

| File | Description | Approx Size |
|------|-------------|-------------|
| nodeblast_game_arena_1.glb | Full arena map | 120 × 120 units footprint |
| nodeblast_player1.glb | Pill capsule player | 0.7w × 1.8h units |
| nodeblast_gun_pistol.glb | Space Pistol | ~0.3 units long |
| nodeblast_gun_machinegun.glb | Machine Gun | ~0.4 units long |
| nodeblast_gun_plasma.glb | Plasma Cannon | ~0.45 units long |
| nodeblast_gun_nodeblaster.glb | Node Blaster | ~0.4 units long |
| nodeblast_enemy1_node.glb | Enemy sphere/node | ~0.6 diameter |

## Workflow
1. Edit model in Maya/Blender/ZBrush
2. Export as GLB to this folder (overwrite existing file)
3. `git add . && git commit -m "update [asset name]" && git push`
4. Vercel auto-deploys → live immediately

## Collision
Collision is handled in code via `_colBlocks[]` array in `game.js`.
The GLB mesh is visual only — collision boxes are registered separately.
Do NOT expect the 3D mesh to auto-collide.
