import * as THREE from 'three'
import * as React from 'react'
import create, { GetState, SetState, UseStore } from 'zustand'
import shallow from 'zustand/shallow'

import { Instance, InstanceProps, LocalState } from '../core/renderer'
import {
  RootState,
  PixelRatio,
  Camera,
  Size,
  isOrthographicCamera,
  RenderCallback,
  StoreProps,
  InternalState,
  Events,
} from '../core/store'

type MockRootState = Omit<RootState, 'gl' | 'scene' | 'onCreated' | 'internal' | 'set' | 'get'> & {
  gl: {}
  scene: MockScene
  internal: Omit<InternalState, 'set' | 'lastProps'> & {
    set: SetState<MockRootState>
    lastProps: MockStoreProps
  }
  set: SetState<MockRootState>
  get: GetState<MockRootState>
  onCreated?: (props: MockRootState) => Promise<any> | void
}

export type MockStoreProps = Omit<StoreProps, 'onCreated' | 'gl'> & {
  onCreated?: (props: MockRootState) => Promise<any> | void
  gl: {}
}

export type MockUseStoreState = UseStore<MockRootState>

type MockInstance = Omit<Instance, '__r3f'> & {
  __r3f: Omit<LocalState, 'root' | 'objects'> & {
    root: MockUseStoreState
    objects: MockSceneChild[]
  }
}

export type MockSceneChild = Omit<THREE.Object3D, 'children'> &
  MockInstance & {
    children: MockSceneChild[]
  }

export type MockScene = Omit<THREE.Scene, 'children'> &
  MockInstance & {
    children: MockSceneChild[]
  }

const context = React.createContext<MockUseStoreState>({} as MockUseStoreState)

const createMockStore = (
  applyProps: (instance: Instance, newProps: InstanceProps, oldProps?: InstanceProps, accumulative?: boolean) => void,
  props: MockStoreProps,
): MockUseStoreState => {
  const {
    size,
    vr = false,
    noninteractive = false,
    linear = false,
    orthographic = false,
    frameloop = true,
    updateCamera = true,
    pixelRatio = 1,
    performance,
    clock = new THREE.Clock(),
    raycaster: raycastOptions,
    camera: cameraOptions,
    onCreated,
    onPointerMissed,
  } = props

  // Create custom raycaster
  const raycaster = new THREE.Raycaster()
  if (raycastOptions) {
    applyProps(raycaster as any, raycastOptions, {})
  }

  // Create default camera
  const isCamera = cameraOptions instanceof THREE.Camera
  const camera = isCamera
    ? (cameraOptions as Camera)
    : orthographic
    ? new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 1000)
    : new THREE.PerspectiveCamera(75, 0, 0.1, 1000)
  if (!isCamera) {
    camera.position.z = 5
    if (orthographic) camera.zoom = 100
    if (cameraOptions) applyProps(camera as any, cameraOptions as any, {})
    // Always look at center by default
    camera.lookAt(0, 0, 0)
  }

  const scene = new THREE.Scene() as MockScene
  scene.__r3f = {
    memoizedProps: {},
    root: {} as MockUseStoreState,
    objects: [],
  }

  const initialPixelRatio = setPixelRatio(pixelRatio)
  function setPixelRatio(pixelRatio: PixelRatio) {
    return Array.isArray(pixelRatio)
      ? Math.max(Math.min(pixelRatio[0], window.devicePixelRatio), pixelRatio[1])
      : pixelRatio
  }

  const rootState = create<MockRootState>((set, get) => {
    const position = new THREE.Vector3()
    const defaultTarget = new THREE.Vector3()
    function getCurrentViewport(
      camera: Camera = get().camera,
      target: THREE.Vector3 = defaultTarget,
      size: Size = get().size,
    ) {
      const { width, height } = size
      const aspect = width / height
      const distance = camera.getWorldPosition(position).distanceTo(target)
      if (isOrthographicCamera(camera)) {
        return { width: width / camera.zoom, height: height / camera.zoom, factor: 1, distance, aspect }
      } else {
        const fov = (camera.fov * Math.PI) / 180 // convert vertical fov to radians
        const h = 2 * Math.tan(fov / 2) * distance // visible height
        const w = h * (width / height)
        return { width: w, height: h, factor: width / w, distance, aspect }
      }
    }

    let performanceTimeout: number | undefined = undefined
    const setPerformanceCurrent = (current: number) =>
      set((state) => ({ performance: { ...state.performance, current } }))

    return {
      gl: {},
      scene,
      camera,
      raycaster,
      clock,
      mouse: new THREE.Vector2(),

      vr,
      noninteractive,
      linear,
      frameloop,
      updateCamera,
      onCreated,
      onPointerMissed,

      performance: {
        current: 1,
        min: 0.5,
        max: 1,
        debounce: 200,
        ...performance,
        regress: () => {
          clearTimeout(performanceTimeout)
          // Set lower bound performance
          setPerformanceCurrent(get().performance.min)
          // Go back to upper bound performance after a while unless something regresses meanwhile
          performanceTimeout = setTimeout(
            () => setPerformanceCurrent(get().performance.max),
            get().performance.debounce,
          )
        },
      },

      size: { width: 0, height: 0 },
      viewport: {
        initialPixelRatio,
        pixelRatio: initialPixelRatio,
        width: 0,
        height: 0,
        aspect: 0,
        distance: 0,
        factor: 0,
        getCurrentViewport,
      },

      set,
      get,
      invalidate: (frames?: number) => {},
      intersect: (event?: any) => {},
      setSize: (width: number, height: number) => {
        const size = { width, height }
        set((state) => ({ size, viewport: { ...state.viewport, ...getCurrentViewport(camera, defaultTarget, size) } }))
      },
      setCamera: (camera: Camera) => {
        set({ camera })
      },
      setPixelRatio: (pixelRatio: PixelRatio) => {
        set((state) => ({ viewport: { ...state.viewport, pixelRatio: setPixelRatio(pixelRatio) } }))
      },

      internal: {
        manual: 0,
        frames: 0,
        lastProps: props,
        events: {} as Events,

        interaction: [],
        subscribers: [],
        captured: undefined,
        initialClick: [0, 0],
        initialHits: [],

        set,
        subscribe: (ref: React.MutableRefObject<RenderCallback>, priority = 0) => {
          const internal = get().internal
          // If this subscription was given a priority, it takes rendering into its own hands
          // For that reason we switch off automatic rendering and increase the manual flag
          // As long as this flag is positive (there could be multiple render subscription)
          // ..there can be no internal rendering at all
          if (priority) internal.manual++

          internal.subscribers.push({ ref, priority: priority })
          // Sort layers from lowest to highest, meaning, highest priority renders last (on top of the other frames)
          internal.subscribers = internal.subscribers.sort((a, b) => a.priority - b.priority)
          return () => {
            if (internal?.subscribers) {
              // Decrease manual flag if this subscription had a priority
              if (priority) internal.manual--
              internal.subscribers = internal.subscribers.filter((s) => s.ref !== ref)
            }
          }
        },
      },
    }
  })

  // Resize camera and renderer on changes to size and pixelratio
  rootState.subscribe(
    () => {
      const { camera, size, updateCamera } = rootState.getState()

      // https://github.com/pmndrs/react-three-fiber/issues/92
      // Sometimes automatic default camera adjustment isn't wanted behaviour
      if (updateCamera) {
        if (isOrthographicCamera(camera)) {
          camera.left = size.width / -2
          camera.right = size.width / 2
          camera.top = size.height / 2
          camera.bottom = size.height / -2
        } else {
          camera.aspect = size.width / size.height
        }
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()
      }
    },
    (state) => [state.viewport.pixelRatio, state.size],
    shallow,
  )

  const state = rootState.getState()
  // Update size
  if (size) {
    state.setSize(size.width, size.height)
  }

  // Return root state
  return rootState
}

export { createMockStore, context }
