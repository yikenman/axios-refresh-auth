import axios, { AxiosInstance } from 'axios';
import { proxyAxios } from './proxy-axios';

describe('proxyAxios', () => {
  let instance: AxiosInstance;
  let proxied: AxiosInstance;

  beforeEach(() => {
    instance = axios.create();

    (instance as unknown as jest.Mock) = jest.fn().mockResolvedValue({ data: 'ok' });
    (instance.request as jest.Mock) = jest.fn().mockResolvedValue({ data: 'ok' });
    (instance.get as jest.Mock) = jest.fn().mockResolvedValue({ data: 'ok' });
    (instance.post as jest.Mock) = jest.fn().mockResolvedValue({ data: 'ok' });

    // @ts-ignore
    proxied = proxyAxios(instance, { baseURL: 'https://example.com', headers: { common: 'test' } });
  });

  it('should merge default config for request method', async () => {
    await proxied.request({
      url: '/far',
      headers: { Authorization: 'token' }
    });

    expect(instance.request).toHaveBeenCalledTimes(1);
    const [mergedConfig] = (instance.request as jest.Mock).mock.calls[0];
    expect(mergedConfig.url).toBe('/far');
    expect(mergedConfig.baseURL).toBe('https://example.com');
    expect(mergedConfig.headers.Authorization).toBe('token');
    expect(mergedConfig.headers.common).toBe('test');
  });

  it('should merge default config for get method', async () => {
    await proxied.get('/foo', { headers: { Authorization: 'token' } });

    expect(instance.get).toHaveBeenCalledTimes(1);
    const [url, config] = (instance.get as jest.Mock).mock.calls[0];
    expect(url).toBe('/foo');
    expect(config.baseURL).toBe('https://example.com');
    expect(config.headers.Authorization).toBe('token');
    expect(config.headers.common).toBe('test');
  });

  it('should merge default config for post method with data', async () => {
    await proxied.post('/bar', { foo: 1 }, { headers: { Authorization: 'token' } });

    expect(instance.post).toHaveBeenCalledTimes(1);
    const [url, data, config] = (instance.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/bar');
    expect(data).toEqual({ foo: 1 });
    expect(config.baseURL).toBe('https://example.com');
    expect(config.headers.Authorization).toBe('token');
    expect(config.headers.common).toBe('test');
  });

  it('should handle calling instance()', async () => {
    // @ts-ignore
    await proxied();

    expect(instance).toHaveBeenCalledTimes(1);
    const args = (instance as unknown as jest.Mock).mock.calls[0];
    expect(args.length).toBe(0);
  });

  it('should handle calling instance(config)', async () => {
    const config = { url: '/direct', method: 'get', headers: { Authorization: 'token' } };
    await proxied(config);

    expect(instance).toHaveBeenCalledTimes(1);
    const [mergedConfig] = (instance as unknown as jest.Mock).mock.calls[0];
    expect(mergedConfig.url).toBe('/direct');
    expect(mergedConfig.baseURL).toBe('https://example.com');
    expect(mergedConfig.headers.Authorization).toBe('token');
    expect(mergedConfig.headers.common).toBe('test');
  });

  it('should handle calling instance(url, config)', async () => {
    await proxied('/foo', { headers: { Authorization: 'token' } });

    expect(instance).toHaveBeenCalledTimes(1);
    const [url, config] = (instance as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('/foo');
    expect(config.baseURL).toBe('https://example.com');
    expect(config.headers.Authorization).toBe('token');
    expect(config.headers.common).toBe('test');
  });
});
