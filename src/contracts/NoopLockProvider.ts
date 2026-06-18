import { LockProvider } from '../types'

export class NoopLockProvider implements LockProvider {
  async withInvoiceChainLock<T>(_tenantId: string, work: () => Promise<T>): Promise<T> {
    return work()
  }
}
