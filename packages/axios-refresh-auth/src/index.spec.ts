import { createInterceptorRegister } from './index';

describe('interceptor exports existence', () => {
  it('should export createInterceptorRegister', () => {
    expect(createInterceptorRegister).toBeDefined();
    expect(typeof createInterceptorRegister).toBe('function');
  });
});
