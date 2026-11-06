/** three.js-scenen: transparent canvas ovanpå kameran. Världsram: x = öst, y = upp, −z = norr. */
import {
  BoxGeometry, BufferGeometry, Color, DoubleSide, EdgesGeometry, GridHelper, Group, Line, LineBasicMaterial,
  LineSegments, Material, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, RingGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';
import type { Quat } from '../geo/orientation';
import type { NearbyTrain } from './nearby';

export const EYE_HEIGHT_M = 1.6;
const TRAIN = { width: 3, height: 3.5, length: 90 };

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
  private ringGeo = new RingGeometry(2, 3, 24).rotateX(-Math.PI / 2);
  private mats = new Map<string, { fill: MeshBasicMaterial; edge: LineBasicMaterial; drop: LineBasicMaterial; ring: MeshBasicMaterial }>();
  private tmp = new Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(0, EYE_HEIGHT_M, 0);
    this.camera.rotation.order = 'YXZ';
    this.buildGround();
    this.resize();
  }

  private buildGround(): void {
    // Grovt rutnät (20 m) ut till 300 m, finare (5 m) nära fötterna där kameran ser marken
    for (const [size, div, opacity] of [[600, 30, 0.3], [100, 20, 0.5]] as const) {
      const grid = new GridHelper(size, div, 0x66ddff, 0x66ddff);
      (grid.material as Material).transparent = true;
      (grid.material as Material).opacity = opacity;
      (grid.material as Material).depthWrite = false;
      this.scene.add(grid);
    }
    const plane = new Mesh(
      new PlaneGeometry(600, 600).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x3399cc, transparent: true, opacity: 0.1, side: DoubleSide, depthWrite: false }),
    );
    this.scene.add(plane);
    // Röd linje mot norr (−z) så att orienteringen syns tydligt
    const north = new Line(
      new BufferGeometry().setFromPoints([new Vector3(0, 0.05, 0), new Vector3(0, 0.05, -300)]),
      new LineBasicMaterial({ color: 0xff5555 }),
    );
    this.scene.add(north);
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
        drop: new LineBasicMaterial({ color: c, transparent: true, opacity: 0.8 }),
        ring: new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, side: DoubleSide }),
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
        const ring = new Mesh(this.ringGeo, m.ring);
        ring.name = 'ring';
        const root = new Group();
        root.add(group, drop, ring);
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
      (o.group.getObjectByName('ring') as Mesh).position.set(x, 0.06, z);
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

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
