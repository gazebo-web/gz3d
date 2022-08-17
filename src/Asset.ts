export type AssetCb = (msg: any) => void;

/**
 * Type that represents a simulation asset that needs to be fetched from a websocket server.
 */

export class Asset {
  /**
   * The URI of the asset file to be fetched.
   */
  public uri: string;

  /**
   * Callback that is used when the asset has been fetched.
   */
  public cb: AssetCb;

  constructor(uri: string, cb: AssetCb) {
    this.uri = uri;
    this.cb = cb;
  }
}
