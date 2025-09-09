import { type ServerType, serve } from '@hono/node-server';
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { Hono } from 'hono';
import { type AxiosRefreshAuthRequestConfig, createInterceptorRegister } from './interceptor';
import { proxyAxios } from './proxy-axios';

const port = 3000;
const axiosConfig = {
  baseURL: `http://localhost:${port}`
};
const sleep = (ms = 50) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

jest.mock('./proxy-axios', () => {
  const actual = jest.requireActual('./proxy-axios');

  return {
    ...actual,
    proxyAxios: jest.fn(actual.proxyAxios)
  };
});

describe('E2E Test', () => {
  const handlers = {
    protected: jest.fn(),
    protectedOther: jest.fn(),
    refresh: jest.fn()
  };
  let server: ServerType;

  beforeAll(() => {
    const app = new Hono();

    app.get('/protected', async (c) => {
      await sleep();
      return handlers.protected(c);
    });
    app.get('/protected-other', async (c) => {
      await sleep();
      return handlers.protectedOther(c);
    });
    app.post('/refresh-token', async (c) => {
      await sleep();
      return handlers.refresh(c);
    });

    server = serve({ fetch: app.fetch, port });
  });

  beforeEach(() => {
    handlers.protected.mockReset();
    handlers.protectedOther.mockReset();
    handlers.refresh.mockReset();
  });

  describe('API Test', () => {
    let api: AxiosInstance;
    let refreshAuthCall = jest.fn();
    const statusCodes = 401;

    beforeEach(() => {
      api = axios.create(axiosConfig);
      refreshAuthCall.mockReset();
    });

    describe('refreshAuthCall', () => {
      it('should call refreshAuthCall with Axios error and an instance with skipAuthRefresh enabled', async () => {
        let err: AxiosError | undefined = undefined;

        refreshAuthCall.mockImplementation((_, instance) => {
          expect(instance).toBe(jest.mocked(proxyAxios).mock.results[0].value);
        });

        const register = createInterceptorRegister(refreshAuthCall, {
          statusCodes: [statusCodes]
        });
        register(api);

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await api.get('/protected');
        } catch (error) {
          err = error;
        }

        expect(proxyAxios).toHaveBeenCalledTimes(1);
        expect(proxyAxios).toHaveBeenCalledWith(api, { skipAuthRefresh: true });
        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(refreshAuthCall).toHaveBeenCalledWith(expect.any(AxiosError), expect.any(Function));
        expect(err).toBeUndefined();
      });
    });

    describe('register', () => {
      it('should be able to register/unregister interceptors on axios instance', () => {
        const register = createInterceptorRegister(refreshAuthCall);
        const unregister = register(api);

        expect((api.interceptors.request as any).handlers.length).toBe(1);
        expect((api.interceptors.request as any).handlers[0].fulfilled).toBeDefined();
        expect((api.interceptors.request as any).handlers[0].rejected).not.toBeDefined();

        expect((api.interceptors.response as any).handlers.length).toBe(1);
        expect((api.interceptors.response as any).handlers[0].fulfilled).toBeDefined();
        expect((api.interceptors.response as any).handlers[0].rejected).toBeDefined();

        unregister();

        expect((api.interceptors.request as any).handlers.length).toBe(1);
        expect((api.interceptors.request as any).handlers[0]).toBeNull();

        expect((api.interceptors.response as any).handlers.length).toBe(1);
        expect((api.interceptors.response as any).handlers[0]).toBeNull();
      });

      it('should skip registering multiple time on one instance', () => {
        const register = createInterceptorRegister(refreshAuthCall);
        register(api);
        register(api);
        register(api);
        const unregister = register(api);

        expect((api.interceptors.request as any).handlers.length).toBe(1);
        expect((api.interceptors.request as any).handlers[0].fulfilled).toBeDefined();
        expect((api.interceptors.request as any).handlers[0].rejected).not.toBeDefined();

        expect((api.interceptors.response as any).handlers.length).toBe(1);
        expect((api.interceptors.response as any).handlers[0].fulfilled).toBeDefined();
        expect((api.interceptors.response as any).handlers[0].rejected).toBeDefined();

        unregister();

        expect((api.interceptors.request as any).handlers.length).toBe(1);
        expect((api.interceptors.request as any).handlers[0]).toBeNull();

        expect((api.interceptors.response as any).handlers.length).toBe(1);
        expect((api.interceptors.response as any).handlers[0]).toBeNull();
      });

      it('should be able to re-register after unregistered', () => {
        const register = createInterceptorRegister(refreshAuthCall);
        register(api);
        const unregister = register(api);
        unregister();
        register(api);

        expect((api.interceptors.request as any).handlers.length).toBe(2);
        expect((api.interceptors.request as any).handlers[0]).toBeNull();
        expect((api.interceptors.request as any).handlers[1].fulfilled).toBeDefined();
        expect((api.interceptors.request as any).handlers[1].rejected).not.toBeDefined();

        expect((api.interceptors.response as any).handlers.length).toBe(2);
        expect((api.interceptors.response as any).handlers[0]).toBeNull();
        expect((api.interceptors.response as any).handlers[1].fulfilled).toBeDefined();
        expect((api.interceptors.response as any).handlers[1].rejected).toBeDefined();
      });
    });

    describe('Options', () => {
      describe('Option: statusCodes', () => {
        const refreshError = new Error('Refresh Error');

        beforeEach(() => {
          refreshAuthCall.mockImplementation((e) => {
            throw refreshError;
          });

          const register = createInterceptorRegister(refreshAuthCall, {
            statusCodes: [statusCodes]
          });
          register(api);
        });

        it('should trigger refresh if error status code is in statusCodes', async () => {
          let err: AxiosError | undefined = undefined;

          handlers.protected.mockImplementationOnce((c) => c.text('Unauthorized', statusCodes));

          try {
            await api.get('/protected');
          } catch (error) {
            err = error;
          }

          expect(refreshAuthCall).toHaveBeenCalled();
          expect(err?.response?.status).toBe(statusCodes);
          expect(err?.cause).toBe(refreshError);
        });

        it('should not trigger refresh if error status code is not in statusCodes', async () => {
          const otherCode = 498;
          let err: AxiosError | undefined = undefined;

          handlers.protected.mockImplementationOnce((c) => c.text('Unauthorized', otherCode));

          try {
            await api.get('/protected');
          } catch (error) {
            err = error;
          }

          expect(refreshAuthCall).not.toHaveBeenCalled();
          expect(err?.response?.status).toBe(otherCode);
          expect(err?.cause).toBe(undefined);
        });
      });

      describe('Option: statusCodes', () => {
        const refreshError = new Error('Refresh Error');

        beforeEach(() => {
          refreshAuthCall.mockImplementation((e) => {
            throw refreshError;
          });

          const register = createInterceptorRegister(refreshAuthCall, {});
          register(api);
        });

        it('should trigger refresh if error status code is 401 by default', async () => {
          let err: AxiosError | undefined = undefined;

          handlers.protected.mockImplementationOnce((c) => c.text('Unauthorized', statusCodes));

          try {
            await api.get('/protected');
          } catch (error) {
            err = error;
          }

          expect(refreshAuthCall).toHaveBeenCalled();
          expect(err?.response?.status).toBe(statusCodes);
        });
      });

      describe('Option: statusCodes', () => {
        const refreshError = new Error('Refresh Error');

        beforeEach(() => {
          refreshAuthCall.mockImplementation((e) => {
            throw refreshError;
          });

          const register = createInterceptorRegister(refreshAuthCall, {
            statusCodes: statusCodes
          });
          register(api);
        });

        it('should also support non-array value', async () => {
          let err: AxiosError | undefined = undefined;

          handlers.protected.mockImplementationOnce((c) => c.text('Unauthorized', statusCodes));

          try {
            await api.get('/protected');
          } catch (error) {
            err = error;
          }

          expect(refreshAuthCall).toHaveBeenCalled();
          expect(err?.response?.status).toBe(statusCodes);
        });

        it('should also handle network error', async () => {
          const register = createInterceptorRegister(refreshAuthCall, {
            interceptNetworkError: true
          });
          register(api);

          const reqRejectInterceptor = (api.interceptors.response as any).handlers[0].rejected;

          const error: AxiosError = {
            name: 'AxiosError',
            message: 'Network Error',
            config: { url: '/protected', method: 'get', headers: {} as any },
            isAxiosError: true,
            toJSON: () => ({}),
            request: { status: 0 },
            response: {} as any,
            code: undefined
          };

          let err: AxiosError | undefined = undefined;
          try {
            await reqRejectInterceptor(error);
          } catch (error) {
            err = error;
          }

          expect(err).toBe(error);
          expect(refreshAuthCall).not.toHaveBeenCalled();
        });
      });

      describe('Option: shouldRefresh (function)', () => {
        const refreshError = new Error('Refresh Error');
        const shouldRefresh = jest.fn();

        beforeEach(() => {
          refreshAuthCall.mockImplementation((e) => {
            throw refreshError;
          });
          shouldRefresh.mockReset();

          const register = createInterceptorRegister(refreshAuthCall, {
            statusCodes: [statusCodes],
            shouldRefresh
          });
          register(api);
        });

        it('should only use shouldRefresh if statusCodes is also provided', async () => {
          const otherCode = 498;
          let err: AxiosError | undefined = undefined;

          shouldRefresh.mockImplementationOnce(() => true);
          handlers.protected.mockImplementationOnce((c) => c.text('Unauthorized', otherCode));

          try {
            await api.get('/protected');
          } catch (error) {
            err = error;
          }

          expect(shouldRefresh).toHaveBeenCalled();
          expect(refreshAuthCall).toHaveBeenCalled();
          expect(err?.response?.status).toBe(otherCode);
        });

        it('should trigger refresh if shouldRefresh return true', async () => {
          shouldRefresh.mockImplementationOnce(() => true);
          handlers.protected.mockImplementationOnce((c) => c.text('Unauthorized', statusCodes));

          try {
            await api.get('/protected');
          } catch (error) {}

          expect(shouldRefresh).toHaveBeenCalled();
          expect(refreshAuthCall).toHaveBeenCalled();
        });

        it('should not trigger refresh if shouldRefresh return false', async () => {
          shouldRefresh.mockImplementationOnce(() => false);
          handlers.protected.mockImplementationOnce((c) => c.text('Unauthorized', statusCodes));

          try {
            await api.get('/protected');
          } catch (error) {}

          expect(shouldRefresh).toHaveBeenCalled();
          expect(refreshAuthCall).not.toHaveBeenCalled();
        });
      });

      // can only test req reject interceptor
      describe('Option: interceptNetworkError', () => {
        const refreshError = new Error('Refresh Error');

        beforeEach(() => {
          refreshAuthCall.mockImplementation((e) => {
            throw refreshError;
          });
        });

        it('should trigger refresh when network error if disabled', async () => {
          const register = createInterceptorRegister(refreshAuthCall, {
            interceptNetworkError: true
          });
          register(api);

          const reqRejectInterceptor = (api.interceptors.response as any).handlers[0].rejected;

          const error: AxiosError = {
            name: 'AxiosError',
            message: 'Network Error',
            config: { url: '/protected', method: 'get', headers: {} as any },
            isAxiosError: true,
            toJSON: () => ({}),
            request: { status: 0 },
            response: undefined,
            code: undefined
          };

          let err: AxiosError | undefined = undefined;
          try {
            await reqRejectInterceptor(error);
          } catch (error) {
            err = error;
          }

          expect(err).toBe(error);
          expect(refreshAuthCall).toHaveBeenCalled();
        });

        it('should not trigger refresh when network error if enabled', async () => {
          const register = createInterceptorRegister(refreshAuthCall, {
            interceptNetworkError: false
          });
          register(api);

          const reqRejectInterceptor = (api.interceptors.response as any).handlers[0].rejected;

          const error: AxiosError = {
            name: 'AxiosError',
            message: 'Network Error',
            config: { url: '/protected', method: 'get', headers: {} as any },
            isAxiosError: true,
            toJSON: () => ({}),
            request: { status: 0 },
            response: undefined,
            code: undefined
          };

          let err: AxiosError | undefined = undefined;
          try {
            await reqRejectInterceptor(error);
          } catch (error) {
            err = error;
          }

          expect(err).toBe(error);
          expect(refreshAuthCall).not.toHaveBeenCalled();
        });
      });

      describe('Option: onRetry (function)', () => {
        const onRetry = jest.fn((e) => e);

        beforeEach(() => {
          onRetry.mockClear();

          const register = createInterceptorRegister(refreshAuthCall, {
            onRetry
          });
          register(api);
        });

        it('should call onRetry before request retry if provided', async () => {
          let err: AxiosError | undefined = undefined;

          handlers.protected
            .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
            .mockImplementation((c) => c.text('Authorized', 200));

          try {
            await api.get('/protected');
          } catch (error) {
            err = error;
          }

          expect(refreshAuthCall).toHaveBeenCalled();
          expect(onRetry).toHaveBeenCalled();
          expect(err).toBeUndefined();
        });
      });

      describe('Option: retryInstance', () => {
        it('should use retryInstance in onRetry function', async () => {
          let err: AxiosError | undefined = undefined;

          const retryInstance = jest.fn().mockResolvedValue(Promise.resolve()) as unknown as typeof api;

          const register = createInterceptorRegister(refreshAuthCall, {
            retryInstance
          });
          register(api);

          handlers.protected
            .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
            .mockImplementation((c) => c.text('Authorized', 200));

          try {
            await api.get('/protected');
          } catch (error) {
            err = error;
          }

          expect(refreshAuthCall).toHaveBeenCalled();
          expect(retryInstance).toHaveBeenCalled();
          expect(err).toBeUndefined();
        });

        it('should use origin instance if not provided', async () => {
          let err: AxiosError | undefined = undefined;

          const mocked = jest.fn().mockImplementation(() => {
            return Promise.resolve();
          }) as unknown as typeof api;

          Object.assign(mocked, api);
          Object.setPrototypeOf(mocked, Object.getPrototypeOf(api));

          const register = createInterceptorRegister(refreshAuthCall, {});
          register(mocked);

          handlers.protected
            .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
            .mockImplementation((c) => c.text('Authorized', 200));

          try {
            await api.get('/protected');
          } catch (error) {
            err = error;
          }

          expect(refreshAuthCall).toHaveBeenCalled();
          expect(mocked).toHaveBeenCalled();
          expect(err).toBeUndefined();
        });
      });

      describe('Option: maxRefreshTimes', () => {
        let warn: jest.SpyInstance;
        beforeEach(() => {
          warn = jest.spyOn(console, 'warn').mockImplementation();
        });

        it('By default, if a retry fails and triggers a refresh again, the refresh flow is entered once.', async () => {
          const register = createInterceptorRegister(refreshAuthCall, {});
          register(api);

          handlers.protected.mockImplementation((c) => c.text('Unauthorized', statusCodes));

          try {
            await api.get('/protected');
          } catch (error) {}

          expect(warn).toHaveBeenCalled();
          expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        });

        it('The refresh flow can be retried up to the specified maxRefreshTimes.', async () => {
          const register = createInterceptorRegister(refreshAuthCall, {
            maxRefreshTimes: 3
          });
          register(api);

          handlers.protected.mockImplementation((c) => c.text('Unauthorized', statusCodes));

          try {
            await api.get('/protected');
          } catch (error) {}

          expect(warn).toHaveBeenCalled();
          expect(refreshAuthCall).toHaveBeenCalledTimes(3);
        });
      });
    });

    describe('Config: skipAuthRefresh', () => {
      it('should skip refresh if skipAuthRefresh is true', async () => {
        const register = createInterceptorRegister(refreshAuthCall, {});
        register(api);

        handlers.protected.mockImplementation((c) => c.text('Unauthorized', statusCodes));

        try {
          await api.get('/protected', {
            skipAuthRefresh: true
          } as AxiosRefreshAuthRequestConfig);
        } catch (error) {}

        expect(refreshAuthCall).not.toHaveBeenCalled();
      });
    });
  });

  describe('Concurrency Scenarios', () => {
    let api: AxiosInstance;
    let refreshAuthCall = jest.fn();
    let onRetry = jest.fn((e) => e);
    const statusCodes = 401;

    beforeEach(() => {
      refreshAuthCall = jest.fn();
      onRetry = jest.fn((e) => e);

      api = axios.create({
        ...axiosConfig
      });

      const register = createInterceptorRegister(refreshAuthCall, {
        statusCodes: [statusCodes],
        onRetry
      });
      register(api);
    });

    describe('Case 1: A and B use the same instance', () => {
      it('After A refreshed and ended, request B sent and failed. should trigger its own refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await api.get('/protected');
          await sleep(300);
          await api.get('/protected-other');
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('After A refreshed and ended, request B sent and succeeded. should not trigger any refresh and retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther.mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await api.get('/protected');
          await sleep(300);
          await api.get('/protected-other');
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B is sent. B should wait for A’s refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          api.defaults.headers.common['Authorization'] = 'Bearer NEW_TOKEN';
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther.mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([
            api.get('/protected'),
            // ensure protectedOther triggers after first protected responsed
            sleep(90).then(() => {
              return api.get('/protected-other');
            })
          ]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B fails. B should wait for A’s refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther failed after first protected responsed
            await sleep(20);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([api.get('/protected'), api.get('/protected-other')]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B was already sent before A. But B fails after A’s refresh completes. B should skip triggering refresh and directly retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther fail after refresh ends
            await sleep(300);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([api.get('/protected-other'), api.get('/protected')]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it("While A's refresh fails, request B was already sent before A. But B fails after A’s refresh ends. B should trigger its own refresh and then retry.", async () => {
        const refreshError = new Error('Refresh Error');
        let err1: AxiosError | undefined = undefined;
        let err2: AxiosError | undefined = undefined;

        refreshAuthCall
          .mockImplementationOnce(async () => {
            await sleep(100);
            throw refreshError;
          })
          .mockImplementation(async () => {
            await sleep(100);
            return;
          });

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther fail after refresh ends
            await sleep(300);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        await Promise.all([
          api.get('/protected-other').catch((error) => {
            err2 = error;
          }),
          api.get('/protected').catch((error) => {
            err1 = error;
          })
        ]);

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(err1!.cause).toBe(refreshError);
        expect(err2).toBeUndefined();
      });
    });

    describe('Case 2: A and B use different instances but share the same interceptor', () => {
      let api1: AxiosInstance;
      let api2: AxiosInstance;

      beforeEach(() => {
        api1 = axios.create(axiosConfig);
        api2 = axios.create(axiosConfig);

        const register = createInterceptorRegister(refreshAuthCall, {
          statusCodes: [statusCodes],
          onRetry
        });
        register(api1);
        register(api2);
      });

      it('After A refreshed and ended, request B sent and failed. should trigger its own refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await api1.get('/protected');
          await sleep(300);
          await api2.get('/protected-other');
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('After A refreshed and ended, request B sent and succeeded. should not trigger any refresh and retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther.mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await api1.get('/protected');
          await sleep(300);
          await api2.get('/protected-other');
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B is sent. B should wait for A’s refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther.mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([
            api1.get('/protected'),
            // ensure protectedOther triggers after first protected responsed
            sleep(90).then(() => {
              return api2.get('/protected-other');
            })
          ]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B fails. B should wait for A’s refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther failed after first protected responsed
            await sleep(20);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([api1.get('/protected'), api2.get('/protected-other')]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B was already sent before A. But B fails after A’s refresh completes. B should skip triggering refresh and directly retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther fail after refresh ends
            await sleep(300);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([api2.get('/protected-other'), api1.get('/protected')]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it("While A's refresh fails, request B was already sent before A. But B fails after A’s refresh ends. B should trigger its own refresh and then retry.", async () => {
        const refreshError = new Error('Refresh Error');
        let err1: AxiosError | undefined = undefined;
        let err2: AxiosError | undefined = undefined;

        refreshAuthCall
          .mockImplementationOnce(async () => {
            await sleep(100);
            throw refreshError;
          })
          .mockImplementation(async () => {
            await sleep(100);
            return;
          });

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther fail after refresh ends
            await sleep(300);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        await Promise.all([
          api2.get('/protected-other').catch((error) => {
            err2 = error;
          }),
          api1.get('/protected').catch((error) => {
            err1 = error;
          })
        ]);

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(err1!.cause).toBe(refreshError);
        expect(err2).toBeUndefined();
      });
    });

    describe('Case 3: A and B use different instances without sharing interceptors', () => {
      let api1: AxiosInstance;
      let api2: AxiosInstance;

      beforeEach(() => {
        api1 = axios.create(axiosConfig);
        api2 = axios.create(axiosConfig);

        createInterceptorRegister(refreshAuthCall, {
          statusCodes: [statusCodes],
          onRetry
        })(api1);
        createInterceptorRegister(refreshAuthCall, {
          statusCodes: [statusCodes],
          onRetry
        })(api2);
      });

      it('After A refreshed and ended, request B sent and failed. should trigger its own refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await api1.get('/protected');
          await sleep(300);
          await api2.get('/protected-other');
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('After A refreshed and ended, request B sent and succeeded. should not trigger any refresh and retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther.mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await api1.get('/protected');
          await sleep(300);
          await api2.get('/protected-other');
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B is sent. B should not wait for A’s refresh, but trigger its own refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([
            api1.get('/protected'),
            // ensure protectedOther triggers after first protected responsed
            sleep(90).then(() => {
              return api2.get('/protected-other');
            })
          ]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B fails. B should not wait for A’s refresh, but trigger its own refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther failed after first protected responsed
            await sleep(20);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([api1.get('/protected'), api2.get('/protected-other')]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('While A is refreshing, request B was already sent before A. But B fails after A’s refresh completes. B should not wait for A’s refresh, but trigger its own refresh and then retry.', async () => {
        refreshAuthCall.mockImplementation(async () => {
          await sleep(100);
          return;
        });

        let err: AxiosError | undefined = undefined;

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther fail after refresh ends
            await sleep(300);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        try {
          await Promise.all([api2.get('/protected-other'), api1.get('/protected')]);
        } catch (error) {
          err = error;
        }

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(err).toBeUndefined();
      });

      it('While A’s refresh fails, request B was already sent before A. But B fails after A’s refresh ends. B should trigger its own refresh refresh and then retry.', async () => {
        const refreshError = new Error('Refresh Error');
        let err1: AxiosError | undefined = undefined;
        let err2: AxiosError | undefined = undefined;

        refreshAuthCall
          .mockImplementationOnce(async () => {
            await sleep(100);
            throw refreshError;
          })
          .mockImplementation(async () => {
            await sleep(100);
            return;
          });

        handlers.protected
          .mockImplementationOnce((c) => c.text('Unauthorized', statusCodes))
          .mockImplementationOnce((c) => c.text('Authorized', 200));
        handlers.protectedOther
          .mockImplementationOnce(async (c) => {
            // ensure protectedOther fail after refresh ends
            await sleep(300);
            return c.text('Unauthorized', statusCodes);
          })
          .mockImplementationOnce((c) => c.text('Authorized', 200));

        await Promise.all([
          api2.get('/protected-other').catch((error) => {
            err2 = error;
          }),
          api1.get('/protected').catch((error) => {
            err1 = error;
          })
        ]);

        expect(refreshAuthCall).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(err1!.cause).toBe(refreshError);
        expect(err2).toBeUndefined();
      });
    });
  });

  afterAll(() => {
    server.close();
  });
});
