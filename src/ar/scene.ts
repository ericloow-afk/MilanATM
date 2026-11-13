/** three.js-scenen: transparent canvas ovanpå kameran. Världsram: x = öst, y = upp, −z = norr. */
import {
  BoxGeometry, BufferGeometry, Color, EdgesGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import type { Quat } from '../geo/orientation';
import { MAX_OVERLAY_OPACITY, type GridSegments, type LocalTrack } from './ground';
import type { NearbyTrain } from './nearby';

export const EYE_HEIGHT_M = 1.6;
export const TRAIN = { width: 3, height: 3.5, length: 90 };

interface TrainObj {
  group: Group;
  line: string;
}

export interface ViewInfo {
  /** NDC (x höger, y uppåt) när framför kameran, annars riktning i kameraramen */
  x: number;
  y: number;
  behind: boolean;
  /** pixlar (CSS) i canvasen */
  px: number;
  py: number;
  distance: number;
}

export class ArScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.5, 2500);
  private objs = new Map<string, TrainObj>();
  private boxGeo = new BoxGeometry(TRAIN.width, TRAIN.height, TRAIN.length);
  private edgeGeo = new EdgesGeometry(this.boxGeo);
  private mats = new Map<string, { fill: MeshBasicMaterial; edge: LineBasicMaterial; drop: LineBasicMaterial; track: LineBasicMaterial }>();
  /** rutnätsbandet runt spåret: tunna linjer, alfa per punkt (src/ar/ground.ts) */
  private grid = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false }),
  );
  private tracks = new Group();
  private showDrops = true;
  private tmp = new Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, EYE_HEIGHT_M, 0);
    this.camera.rotation.order = 'YXZ';
    this.buildGround();
    this.resize();
  }

  /**
   * Inga fyllda ytor (det fyllda markplanet färgade kamerabilden blå, se docs/field-notes-2026-11-08.md, Del 5).
   * Bara tunna linjer: rutnätsbandet runt spåret (standard av), spårlinjen och lodlinjer till tågen.
   */
  private buildGround(): void {
    this.grid.userData.layer = 'grid';
    this.grid.frustumCulled = false;
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.tracks.userData.layer = 'tracks';
    this.scene.add(this.tracks);
    // Nordlinje bara för felsökning (?debug=1 slår på den i Verktyg)
    const north = new Line(
      new BufferGeometry().setFromPoints([new Vector3(0, 0.05, 0), new Vector3(0, 0.05, -80)]),
      new LineBasicMaterial({ color: 0xff5555, transparent: true, opacity: MAX_OVERLAY_OPACITY, depthWrite: false }),
    );
    north.userData.layer = 'north';
    north.visible = false;
    this.scene.add(north);
  }

  /** Rutnätsbandet (null eller opacitet 0 = dolt). Vertex-alfa = utfasning, materialets opacitet = valt läge. */
  setGrid(seg: GridSegments | null, opacity: number): void {
    const on = !!seg && seg.count > 0 && opacity > 0 && !this.debugOff.has('grid');
    this.grid.visible = on;
    if (!seg || !on) return;
    const colors = new Float32Array(seg.count * 4);
    for (let i = 0; i < seg.count; i++) colors.set([1, 1, 1, seg.alphas[i]], i * 4);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(seg.positions, 3));
    g.setAttribute('color', new Float32BufferAttribute(colors, 4));
    this.grid.geometry.dispose();
    this.grid.geometry = g;
    (this.grid.material as LineBasicMaterial).opacity = Math.min(opacity, MAX_OVERLAY_OPACITY);
  }

  /** Spårlinjerna (tunna, linjefärg, opacitet högst 0,25) i höjden y. */
  setTracks(tracks: LocalTrack[], y: number, colorOf: (line: string) => string): void {
    for (const c of [...this.tracks.children]) {
      (c as Line).geometry.dispose();
      this.tracks.remove(c);
    }
    for (const t of tracks) {
      const line = new Line(new BufferGeometry().setFromPoints(t.pts.map(([x, z]) => new Vector3(x, y, z))), this.matsFor(t.line, colorOf(t.line)).track);
      this.tracks.add(line);
    }
  }

  /** Lodlinjer från marken ned till tågen (av i perrongläget, där tågen står på perrongens nivå). */
  setDropLines(on: boolean): void {
    this.showDrops = on;
  }

  setFov(verticalDeg: number): void {
    this.camera.fov = verticalDeg;
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setOrientation(q: Quat): void {
    this.camera.quaternion.set(q[0], q[1], q[2], q[3]);
    this.camera.updateMatrixWorld(true);
  }

  private matsFor(line: string, color: string) {
    let m = this.mats.get(line);
    if (!m) {
      const c = new Color(color);
      m = {
        fill: new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.75 }),
        edge: new LineBasicMaterial({ color: 0xffffff }),
        // allt som inte är ett tåg: högst 0,25 och skriver inte djup (döljer aldrig kamerabilden)
        drop: new LineBasicMaterial({ color: c, transparent: true, opacity: MAX_OVERLAY_OPACITY, depthWrite: false }),
        track: new LineBasicMaterial({ color: c, transparent: true, opacity: MAX_OVERLAY_OPACITY, depthWrite: false }),
      };
      this.mats.set(line, m);
    }
    return m;
  }

  /** Uppdaterar tågobjekten. Tåg som inte längre är med tas bort. */
  setTrains(items: NearbyTrain[], colorOf: (line: string) => string, depthOf: (line: string) => number): void {
    const seen = new Set<string>();
    for (const it of items) {
      const t = it.train;
      seen.add(t.id);
      const depth = depthOf(t.line);
      let o = this.objs.get(t.id);
      if (!o) {
        const m = this.matsFor(t.line, colorOf(t.line));
        const group = new Group();
        const body = new Mesh(this.boxGeo, m.fill);
        body.name = 'body';
        group.add(body, new LineSegments(this.edgeGeo, m.edge));
        const drop = new Line(new BufferGeometry(), m.drop);
        drop.name = 'drop';
        const root = new Group();
        root.add(group, drop);
        root.userData.layer = 'trains';
        root.visible = this.debugOff.has('trains') ? false : true;
        this.scene.add(root);
        o = { group: root, line: t.line };
        this.objs.set(t.id, o);
      }
      const x = it.east;
      const z = -it.north;
      const body = o.group.children[0] as Group;
      body.position.set(x, -depth, z);
      body.rotation.y = -(t.headingDeg * Math.PI) / 180; // lång axel (z) längs färdriktningen
      const drop = o.group.getObjectByName('drop') as Line;
      drop.geometry.setFromPoints([new Vector3(x, -depth + TRAIN.height / 2, z), new Vector3(x, 0, z)]);
      drop.visible = this.showDrops;
    }
    for (const [id, o] of this.objs) {
      if (seen.has(id)) continue;
      this.scene.remove(o.group);
      (o.group.getObjectByName('drop') as Line).geometry.dispose();
      this.objs.delete(id);
    }
  }

  /** Var tåget (kroppens mitt) hamnar relativt kameran och på skärmen. */
  viewOf(id: string): ViewInfo | null {
    const o = this.objs.get(id);
    if (!o) return null;
    const body = o.group.children[0] as Group;
    this.tmp.copy(body.position).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = this.tmp.z > 0;
    const distance = this.tmp.length();
    if (behind) return { x: this.tmp.x, y: this.tmp.y, behind: true, px: 0, py: 0, distance };
    const ndc = body.position.clone().project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: ndc.x, y: ndc.y, behind: false, px: ((ndc.x + 1) / 2) * w, py: ((1 - ndc.y) / 2) * h, distance };
  }

  // ---------- felsökning (?debug=1): slå av/på lager för att hitta vad som färgar bilden ----------
  private debugOff = new Set<string>();
  /** Lager: grid, plane, north, trains (tåg med lodlinje och ring). */
  setLayerVisible(layer: string, on: boolean): void {
    if (on) this.debugOff.delete(layer);
    else this.debugOff.add(layer);
    // rutnätet styrs av setGrid (det kan vara dolt av andra skäl); övriga lager direkt
    if (layer === 'grid') {
      if (!on) this.grid.visible = false;
      return;
    }
    this.scene.traverse((o) => {
      if (o.userData.layer === layer) o.visible = on;
    });
  }
  /** Renderarens inställningar som påverkar om kamerabilden syns igenom. */
  renderState(): Record<string, string> {
    const gl = this.renderer.getContext();
    const attrs = gl.getContextAttributes();
    const cc = new Color();
    this.renderer.getClearColor(cc);
    const big: string[] = [];
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.geometry) return;
      m.geometry.computeBoundingSphere();
      const r = m.geometry.boundingSphere?.radius ?? 0;
      if (r > 50) big.push(`${o.userData.layer ?? o.name ?? 'mesh'} r=${Math.round(r)} m opacity ${(m.material as MeshBasicMaterial).opacity}`);
    });
    return {
      'canvas alpha': String(attrs?.alpha),
      premultipliedAlpha: String(attrs?.premultipliedAlpha),
      clearColor: `#${cc.getHexString()} alpha ${this.renderer.getClearAlpha()}`,
      'scene.background': this.scene.background ? String(this.scene.background) : 'null',
      'scene.fog': this.scene.fog ? 'satt' : 'null',
      'stora ytor': big.join('; ') || 'inga',
    };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
