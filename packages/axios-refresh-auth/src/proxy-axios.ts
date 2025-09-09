import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { mergeConfig } from 'axios';

const METHODS_WITH_DATA = new Set(['post', 'put', 'patch', 'postForm', 'putForm', 'patchForm']);
const METHODS_WITH_URL = new Set(['get', 'delete', 'head', 'options']);
const METHODS_CONFIG_ONLY = new Set(['request', 'getUri']);
const METHODS = new Set([...METHODS_WITH_DATA, ...METHODS_WITH_URL, ...METHODS_CONFIG_ONLY]);

function mergeArgs(method: string, args: any[], defaults: AxiosRequestConfig = {}): any[] {
  let url: string | undefined, data: any, config: AxiosRequestConfig;

  if (METHODS_WITH_DATA.has(method)) {
    [url, data, config = {}] = args;
    return [url, data, mergeConfig(defaults, config)];
  }
  if (METHODS_WITH_URL.has(method)) {
    [url, config = {}] = args;
    return [url, mergeConfig(defaults, config)];
  }
  [config = {}] = args;
  return [mergeConfig(defaults, config)];
}

export const proxyAxios = <T extends AxiosRequestConfig>(axiosInstance: AxiosInstance, defaultConfigs: T) => {
  return new Proxy(axiosInstance, {
    get(target, prop: string, receiver) {
      const origin = Reflect.get(target, prop, receiver);

      if (!METHODS.has(prop)) {
        return origin;
      }
      return (...args: any[]) => Reflect.apply(origin, target, mergeArgs(prop, args, defaultConfigs));
    },
    apply(target, thisArg, args: any[]) {
      if (!args.length) {
        return Reflect.apply(target, thisArg, args);
      }

      const method = typeof args[0] === 'string' ? 'get' : 'request';
      return Reflect.apply(target, thisArg, mergeArgs(method, args, defaultConfigs));
    }
  }) as AxiosInstance;
};
