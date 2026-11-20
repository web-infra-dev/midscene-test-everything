export type * from '@midscene/arm-kit/contracts';
export { robotConnectionKey } from '@midscene/arm-kit/contracts';
export class RobotArmApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
