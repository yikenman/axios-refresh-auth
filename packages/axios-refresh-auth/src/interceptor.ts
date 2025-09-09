import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';
import { proxyAxios } from './proxy-axios';

const DEFAULT_MAX_REFRESH_TIMES = 1;
const DEFAULT_MIN_REFRESH_TIMES = 1;

export interface CreateInterceptorRegisterOptions {
  /**
   * Status codes that should trigger a refresh. Ignored if `shouldRefresh` is provided.
   *
   * default: [401]
   */
  statusCodes?: number | string | Array<number | string>;
  /**
   * Custom logic to determine whether a refresh should be triggered. If set, `statusCodes` will be ignored.
   * @param error AxiosError
   * @returns boolean
   */
  shouldRefresh?(error: AxiosError): boolean;
  /**
   * Axios instance used for retrying failed requests. If not provided, the same instance is used.
   */
  retryInstance?: AxiosInstance;
  /**
   * Whether network errors (e.g. no response) should also trigger refresh logic.
   */
  interceptNetworkError?: boolean;
  /**
   * Hook to adjust the request config before retrying (e.g. re-apply tokens, modify headers).
   * @param requestConfig  AxiosRequestConfig
   * @returns
   */
  onRetry?: <T extends AxiosRequestConfig>(requestConfig: T) => T | Promise<T>;
  /**
   * Prevents infinite loops. Defines the maximum number of times a single request can trigger a refresh. Minimum value is `1`.
   *
   * default: 1
   *
   * min: 1
   */
  maxRefreshTimes?: number;
}

interface RefresherCache {
  refresher?: Promise<any>;
  refreshEndTime: number;
}

export interface AxiosRefreshAuthRequestConfig extends AxiosRequestConfig {
  skipAuthRefresh?: boolean;
}

interface InternalAxiosRefreshAuthRequestConfig extends InternalAxiosRequestConfig {
  skipAuthRefresh?: boolean;
}

const normalizedArray = <T>(val: T | T[]) => {
  return (Array.isArray(val) ? val : [val]).map((ele) => +ele).filter((ele) => !Number.isNaN(ele));
};

const normalizeOptions = (options: CreateInterceptorRegisterOptions) => {
  const normailzedStatusCodes = normalizedArray(options.statusCodes ?? [401]);

  const userShouldRefreshFn =
    options.shouldRefresh ??
    ((error) => {
      return normailzedStatusCodes.includes(error.response!.status ?? -1);
    });

  return {
    onRetry: options.onRetry ?? ((e) => e),
    retryInstance: options.retryInstance,
    shouldRefresh: (error: AxiosError) => {
      // only for fails in browser.
      const isNetworkError = !error.response && error.request?.status === 0;

      // should intecept network error
      if (options.interceptNetworkError && isNetworkError) {
        return true;
      }
      // user custom handler
      return !!error.response && userShouldRefreshFn(error);
    },
    maxRefreshTimes: Math.max(
      +(options.maxRefreshTimes as number) || DEFAULT_MAX_REFRESH_TIMES,
      DEFAULT_MIN_REFRESH_TIMES
    )
  };
};

const REQUEST_START_TIME_SYMBOL = '__$$_Symbol(REQUEST_START_TIME)';
const RETRY_REQUEST_SYMBOL = '__$$_Symbol(RETRY_REQUEST)';
const REGISTERED_SYMBOL = '__$$_Symbol(REGISTERED)';

const retryRequest = (instance: AxiosInstance, config: AxiosRequestConfig) => {
  config[RETRY_REQUEST_SYMBOL] = (config[RETRY_REQUEST_SYMBOL] ?? 0) + 1;
  return instance(config);
};

export const createInterceptorRegister = (
  refreshAuthCall: (error: any, instance: AxiosInstance) => any | Promise<any>,
  options: CreateInterceptorRegisterOptions = {}
) => {
  const cache: RefresherCache = {
    refresher: undefined,
    refreshEndTime: 0
  };

  /**
   * Register interceptors on axios instance.
   *
   * Return a `unregister` function to remove interceptors.
   */
  const register = (instance: AxiosInstance): (() => void) => {
    const { onRetry, retryInstance = instance, shouldRefresh, maxRefreshTimes } = normalizeOptions(options);

    if (instance?.[REGISTERED_SYMBOL]) {
      return instance[REGISTERED_SYMBOL];
    }

    const proxyInstance = proxyAxios<AxiosRefreshAuthRequestConfig>(instance, {
      skipAuthRefresh: true
    });

    let reqInterceptorId: number | undefined = undefined;
    let resInterceptorId: number | undefined = undefined;

    const unregister = () => {
      if (typeof reqInterceptorId === 'number') {
        instance.interceptors.request.eject(reqInterceptorId);
        reqInterceptorId = undefined;
      }
      if (typeof resInterceptorId === 'number') {
        instance.interceptors.response.eject(resInterceptorId);
        resInterceptorId = undefined;
      }
      // only remove unregister in current closure
      if (instance[REGISTERED_SYMBOL] === unregister) {
        instance[REGISTERED_SYMBOL] = undefined;
      }
    };

    reqInterceptorId = instance.interceptors.request.use(async (config: InternalAxiosRefreshAuthRequestConfig) => {
      config[REQUEST_START_TIME_SYMBOL] = Date.now();

      if (config?.skipAuthRefresh) {
        return config;
      }

      if (cache.refresher) {
        await cache.refresher;
        return onRetry(config);
      }

      if (config[RETRY_REQUEST_SYMBOL]) {
        return onRetry(config);
      }

      return config;
    });

    resInterceptorId = instance.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        if (!error || (error.config as AxiosRefreshAuthRequestConfig)?.skipAuthRefresh || !shouldRefresh(error)) {
          return Promise.reject(error);
        }

        if ((error.config as AxiosRefreshAuthRequestConfig)?.[RETRY_REQUEST_SYMBOL] >= maxRefreshTimes) {
          console.warn('Exceeded maximum refresh and retry attempts. Potential infinite loop detected.');
          return Promise.reject(error);
        }

        // network error retry. construct response object.
        error.response =
          error.response ??
          ({
            config: error.config
          } as AxiosResponse);

        const config: AxiosRefreshAuthRequestConfig = error.response.config;

        const requestStartTime: number = config[REQUEST_START_TIME_SYMBOL];
        // outdated requests triggered before refresh resolves but response after refresh resolved.
        if (requestStartTime < cache.refreshEndTime) {
          return retryRequest(retryInstance, config);
        }

        try {
          if (!cache.refresher) {
            const refresher = async () => {
              try {
                await refreshAuthCall(error, proxyInstance);
                cache.refreshEndTime = Date.now();
              } finally {
                cache.refresher = undefined;
              }
            };
            cache.refresher = refresher();
          }

          await cache.refresher;
        } catch (refreshErr) {
          error.cause = refreshErr;
          return Promise.reject(error);
        }

        return retryRequest(retryInstance, config);
      }
    );

    instance[REGISTERED_SYMBOL] = unregister;

    return unregister;
  };

  return register;
};
