import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ScreenPhoneServer } from '@midscene/robotics-vision/phone/server';

/** The phone page has a stable capability scoped to a Bluetooth peer. */
export class PhoneCalibration {
  private phones = new Map<string, ScreenPhoneServer>();

  constructor(private serviceToken: string) {}

  private sign(id: string) {
    return createHmac('sha256', this.serviceToken)
      .update(`iphone-use-phone-calibration:${id}`)
      .digest('hex');
  }

  private phone(id: string, token: string) {
    let phone = this.phones.get(id);
    if (!phone) {
      phone = new ScreenPhoneServer(token);
      this.phones.set(id, phone);
    }
    return phone;
  }

  forPeer(peerId: string) {
    const id = createHash('sha256').update(peerId).digest('hex');
    return this.phone(id, `${id}.${this.sign(id)}`);
  }

  authenticate(req: IncomingMessage) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token') ?? '';
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return;
    const [id, signature] = token.split('.');
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(this.sign(id))))
      return;
    return this.phone(id, token);
  }

  async close() {
    await Promise.all([...this.phones.values()].map((phone) => phone.close()));
    this.phones.clear();
  }
}
