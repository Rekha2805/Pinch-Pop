import { createSystem } from '@iwsdk/core';
import { Vector3 } from 'three';

const PINCH_START_DISTANCE = 0.028;
const PINCH_RELEASE_DISTANCE = 0.045;

let menuPinchHandler:
  ((point: Vector3) => void) | null = null;

export function setMenuPinchHandler(
  handler: ((point: Vector3) => void) | null
) {
  menuPinchHandler = handler;
}

export class MenuPinchSystem extends createSystem({}) {
  private leftPinching = false;
  private rightPinching = false;

  update(_delta: number) {
    const frame = this.world.xrFrame;
    const referenceSpace = this.world.xrReferenceSpace;

    if (
      !frame ||
      !referenceSpace ||
      !this.world.session
    ) {
      return;
    }

    const getJointPose = frame.getJointPose;

    if (typeof getJointPose !== 'function') {
      return;
    }

    let leftPinching = this.leftPinching;
    let rightPinching = this.rightPinching;
    let leftHandSeen = false;
    let rightHandSeen = false;

    for (const inputSource of this.world.session.inputSources) {
      if (!inputSource.hand) {
        continue;
      }

      const isLeft = inputSource.handedness === 'left';
      if (isLeft) {
        leftHandSeen = true;
      } else {
        rightHandSeen = true;
      }

      const thumb = inputSource.hand.get('thumb-tip');
      const index = inputSource.hand.get('index-finger-tip');

      if (!thumb || !index) {
        continue;
      }

      const thumbPose = getJointPose.call(
        frame,
        thumb,
        referenceSpace
      );

      const indexPose = getJointPose.call(
        frame,
        index,
        referenceSpace
      );

      if (!thumbPose || !indexPose) {
        continue;
      }

      const dx =
        thumbPose.transform.position.x -
        indexPose.transform.position.x;

      const dy =
        thumbPose.transform.position.y -
        indexPose.transform.position.y;

      const dz =
        thumbPose.transform.position.z -
        indexPose.transform.position.z;

      const distance = Math.sqrt(
        dx * dx + dy * dy + dz * dz
      );

      const wasPinching = isLeft
        ? this.leftPinching
        : this.rightPinching;

      const isPinching = wasPinching
        ? distance < PINCH_RELEASE_DISTANCE
        : distance < PINCH_START_DISTANCE;

      if (isLeft) {
        leftPinching = isPinching;
      } else {
        rightPinching = isPinching;
      }

      // Trigger only once when a pinch begins
      if (isPinching && !wasPinching && menuPinchHandler) {
        const point = new Vector3(
          (
            thumbPose.transform.position.x +
            indexPose.transform.position.x
          ) / 2,

          (
            thumbPose.transform.position.y +
            indexPose.transform.position.y
          ) / 2,

          (
            thumbPose.transform.position.z +
            indexPose.transform.position.z
          ) / 2
        );

        menuPinchHandler(point);
      }
    }

    this.leftPinching = leftHandSeen && leftPinching;
    this.rightPinching = rightHandSeen && rightPinching;
  }
}
