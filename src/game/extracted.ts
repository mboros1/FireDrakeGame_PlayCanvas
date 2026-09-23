/**
 * The archived Unreal forest extraction, kept loadable at `/?level=extracted`
 * as a rendering load test. Not part of the game; see docs/ARCHITECTURE.md.
 */

import * as pc from 'playcanvas';
import { assetUrl } from '../assets';
import { loadAsset } from '../view/drake';

type ForestAsset = { name: string; category: string; browser_glb: string; exported: boolean };
type ForestInstance = {
  name: string;
  source: 'placed_actor' | 'foliage';
  mesh: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};
type ForestManifest = {
  source_level: string;
  sector: { browser_ground_size_m: number; player_start_position: [number, number, number]; radius_cm: number };
  assets: Record<string, ForestAsset>;
  instances: ForestInstance[];
};

export type ExtractedSector = { objects: number; sourceLevel: string | null; loadError: string | null };

const CATEGORY_COLOURS: Record<string, pc.Color> = {
  tree: new pc.Color(.2, .43, .12),
  bush: new pc.Color(.28, .5, .13),
  flower: new pc.Color(.75, .22, .48),
  mushroom: new pc.Color(.72, .36, .12),
  monument: new pc.Color(.46, .39, .24)
};

/** Load the sector under `parent`, reporting progress into `status` as it goes. */
export async function loadExtractedSector(app: pc.AppBase, parent: pc.Entity, status: ExtractedSector) {
  const materials = new Map<string, pc.StandardMaterial>();
  const materialFor = (category: string) => {
    let m = materials.get(category);
    if (!m) {
      m = new pc.StandardMaterial();
      m.diffuse = CATEGORY_COLOURS[category] ?? new pc.Color(.29, .31, .27);
      m.update();
      materials.set(category, m);
    }
    return m;
  };
  try {
    const response = await fetch(assetUrl('assets/forest-sector/forest-sector.json'));
    if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
    const manifest = await response.json() as ForestManifest;
    status.sourceLevel = manifest.source_level;
    const groundSize = manifest.sector.browser_ground_size_m;
    const ground = new pc.Entity('Extracted sector ground approximation');
    ground.addComponent('render', { type: 'box' });
    const grass = new pc.StandardMaterial();
    grass.diffuse = new pc.Color(.12, .32, .09);
    grass.update();
    ground.render!.material = grass;
    ground.setLocalPosition(0, -.5, 0);
    // Full extent, not half: browser_ground_size_m is the span.
    ground.setLocalScale(groundSize, .5, groundSize);
    parent.addChild(ground);

    const browserAssets = new Map<string, { definition: ForestAsset; container: pc.ContainerResource }>();
    await Promise.all(Object.entries(manifest.assets).map(async ([meshPath, definition]) => {
      if (!definition.exported) return;
      const asset = await loadAsset(app, assetUrl(definition.browser_glb), 'container');
      browserAssets.set(meshPath, { definition, container: asset.resource as pc.ContainerResource });
    }));
    for (const instance of manifest.instances) {
      const browserAsset = browserAssets.get(instance.mesh);
      if (!browserAsset) continue;
      const model = browserAsset.container.instantiateRenderEntity({ castShadows: true });
      model.name = `Extracted ${instance.name}`;
      model.setLocalPosition(...instance.position);
      model.setLocalEulerAngles(...instance.rotation);
      model.setLocalScale(instance.scale[0] * .01, instance.scale[1] * .01, instance.scale[2] * .01);
      for (const render of model.findComponents('render') as pc.RenderComponent[]) {
        if (render.entity.name.startsWith('UCX_')) {
          render.entity.enabled = false;
          continue;
        }
        for (const meshInstance of render.meshInstances) meshInstance.material = materialFor(browserAsset.definition.category);
      }
      parent.addChild(model);
      status.objects++;
    }
  } catch (error) {
    status.loadError = error instanceof Error ? error.message : String(error);
    console.error('The extracted Unreal forest sector could not be loaded', error);
  }
}
