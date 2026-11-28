/**
 * Car types. To add a car: add an entry here (handling) and a shape with the
 * same id in client/src/render/carModels.ts (looks).
 */
export interface CarSpec {
  id: CarId;
  name: string;
  about: string;
  /** top speed, m/s */
  vmax: number;
  /** acceleration from standstill, m/s² */
  accel: number;
  /** braking, m/s² */
  brake: number;
  /** largest lateral acceleration in a turn, m/s²: higher turns tighter */
  grip: number;
  /** how much leaving the asphalt slows the car, 1 = normal */
  offroad: number;
  /** 1..5, shown in the menu */
  stats: { speed: number; accel: number; handling: number; offroad: number };
}

export type CarId = 'sedan' | 'sport' | 'hatch' | 'jeep';

export const CARS: readonly CarSpec[] = [
  {
    id: 'sedan',
    name: 'Седан',
    about: 'Ровный во всём',
    vmax: 55, accel: 11, brake: 20, grip: 18, offroad: 1,
    stats: { speed: 4, accel: 3, handling: 3, offroad: 3 },
  },
  {
    id: 'sport',
    name: 'Спорткар',
    about: 'Самый быстрый на прямых',
    vmax: 64, accel: 12.4, brake: 22, grip: 17.4, offroad: 1.6,
    stats: { speed: 5, accel: 4, handling: 2, offroad: 1 },
  },
  {
    id: 'hatch',
    name: 'Хэтчбек',
    about: 'Резвый и поворотливый',
    vmax: 47, accel: 12.6, brake: 20, grip: 19.8, offroad: 1.1,
    stats: { speed: 2, accel: 5, handling: 5, offroad: 3 },
  },
  {
    id: 'jeep',
    name: 'Внедорожник',
    about: 'Почти не боится травы',
    vmax: 49.5, accel: 11.4, brake: 20, grip: 18.8, offroad: 0.3,
    stats: { speed: 1, accel: 3, handling: 4, offroad: 5 },
  },
];

export const DEFAULT_CAR: CarId = 'sedan';

export function isCarId(v: unknown): v is CarId {
  return CARS.some((c) => c.id === v);
}

export function getCar(id: CarId): CarSpec {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/** Paint colours players can pick; the protocol sends the index. */
export const CAR_COLORS: readonly { hex: string; name: string }[] = [
  { hex: '#e0262f', name: 'Красный' },
  { hex: '#1769e0', name: 'Синий' },
  { hex: '#ff8a00', name: 'Оранжевый' },
  { hex: '#8b3dff', name: 'Фиолетовый' },
  { hex: '#f2f4f7', name: 'Белый' },
  { hex: '#18a058', name: 'Зелёный' },
];
