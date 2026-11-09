import { createComponent, Types } from '@iwsdk/core';

// ECS component: stores data associated with each orb.
export const Orb = createComponent('Orb', {
  color: {
    type: Types.String,
    default: 'red',
  },
  scoreValue: {
    type: Types.Float32,
    default: 1,
  },
});