import * as THREE from 'three';
import { AudioTopic } from './AudioTopic';
import { Publisher } from './Publisher';
import { Scene } from './Scene';
import { SDFParser } from './SDFParser';
import { Shaders } from './Shaders';
import { map, Observable, Subscription } from 'rxjs';
import { Topic } from './Topic';
import { Transport } from './Transport';

/**
 * Interface used to pass arguments to the SceneManager constructor.
 */
export interface SceneManagerConfig {
  /**
   * ElementId is the id of the HTML element that will hold the rendering
   * context. If not specified, the id gz-scene will be used.
   */
  elementId?: string;

  /**
   * A websocket url that points to a Gazebo server.
   */
  websocketUrl?: string;

  /**
   * An authentication key for the websocket server.
   */
  websocketKey?: string;

  /**
   * The name of a an audio control topic, used to play audio files.
   */
  audioTopic?: string;

  /**
   * Name of the topic to advertise.
   */
  topicName?: string;

  /**
   * Message type of the topic to advertise.
   */
  msgType?: string;

  /**
   * Message data of the topic to advertise.
   */
  msgData?: any;
}

/**
 * SceneManager handles the interface between a Gazebo server and the
 * rendering scene. A user of gzweb will typically create a SceneManager and
 * then connect the SceneManager to a Gazebo server's websocket.
 *
 * This example will connect to a Gazebo server's websocket at WS_URL, and
 * start the rendering process. Rendering output will be placed in the HTML
 * element with the id ELEMENT_ID
 *
 * ```
 * let sceneMgr = new SceneManager(ELEMENT_ID, WS_URL, WS_KEY);
 * ```
 */
export class SceneManager {
  /**
   * Particle emitter updates.
   */
  private particleEmittersSubscription: Subscription;

  /**
   * Subscription for status updates.
   */
  private statusSubscription: Subscription;

  /**
   * Connection status from the Websocket.
   */
  private connectionStatus: string = 'disconnected';

  /**
   * Scene Information updates.
   */
  private sceneInfoSubscription: Subscription;

  /**
   * Scene information obtained from the Websocket.
   */
  private sceneInfo: object;

  /**
   * Gz3D Scene.
   */
  private scene: any;

  /**
   * List of 3d models.
   */
  private models: any[] = [];

  /**
   * A sun directional light for global illumination
   */
  private sunLight: object;

  /**
   * A Transport interface used to connect to a Gazebo server.
   */
  private transport = new Transport();

  /**
   * ID of the Request Animation Frame method. Required to cancel the animation.
   */
  private cancelAnimation: number;

  /**
   *
   */
  private previousRenderTimestampMs: number = 0;

  /**
   * The container of the Scene.
   */
  private sceneElement: HTMLElement;

  /**
   * Gz3D SDF parser.
   */
  private sdfParser: any;

  /**
   * Name of the HTML element that will hold the rendering scene.
   */
  private elementId: string = 'gz-scene';

  /**
   * Name of an audio topic, which can be used to playback audio files.
   */
  private audioTopic: string;

  /*
   * Name of the topic to advertise.
   */
  private topicName: string;

  /*
   * Message type of the topic to advertise.
   */
  private msgType: string;

  /*
   * Message data of the topic to advertise.
   */
  private msgData: any

  /*
   * Publisher object to publish to a topic
   */
  private publisher: Publisher;


  /**
   * Constructor. If a url is specified, then then SceneManager will connect
   * to the specified websocket server. Otherwise, the `connect` function
   * should be called after construction.
   * @param params Optional. The scene manager configuration options
   *
   */
  constructor( config: SceneManagerConfig = {}) {
    this.elementId = config.elementId ?? 'gz-scene';

    if (config.audioTopic) {
      this.audioTopic = config.audioTopic;
    }

    if (
      config.topicName &&
      config.msgType &&
      config.msgData
    ) {
      this.topicName = config.topicName;
      this.msgType = config.msgType;
      this.msgData = config.msgData;
    }

    if (config.websocketUrl) {
      this.connect(config.websocketUrl, config.websocketKey);
    }
  }

  /**
   * Destrory the scene
   */
  public destroy(): void {
    this.disconnect();

    if (this.cancelAnimation) {
      cancelAnimationFrame(this.cancelAnimation);
    }

    this.previousRenderTimestampMs = 0;

    if (this.scene) {
      this.scene.cleanup();
    }
  }

  /**
   * Get the current connection status to a Gazebo server.
   */
  public getConnectionStatus(): string {
    return this.connectionStatus;
  }

  /**
   * Get the connection status as an observable.
   * Allows clients to subscribe to this stream, to let them know when the connection to Gazebo
   * is ready for communication.
   *
   * @returns An Observable of a boolean: Whether the connection status is ready or not.
   */
  public getConnectionStatusAsObservable(): Observable<boolean> {
    return this.transport.getConnectionStatus().pipe(
      map((status) => status === 'ready'),
    );
  }

  /**
   * Change the width and height of the visualization upon a resize event.
   */
  public resize(): void {
    if (this.scene) {
      this.scene.setSize(this.sceneElement.clientWidth,
                         this.sceneElement.clientHeight);
    }
  }

  public snapshot(): void {
    if (this.scene) {
      this.scene.saveScreenshot(this.transport.getWorld());
    }
  }

  public resetView(): void {
    if (this.scene) {
      this.scene.resetView();
    }
  }

  public follow(entityName: string): void {
    if (this.scene) {
      this.scene.emitter.emit('follow_entity', entityName);
    }
  }

  public thirdPersonFollow(entityName: string): void {
    if (this.scene) {
      this.scene.emitter.emit('third_person_follow_entity', entityName);
    }
  }

  public firstPerson(entityName: string): void {
    if (this.scene) {
      this.scene.emitter.emit('first_person_entity', entityName);
    }
  }

  public moveTo(entityName: string): void {
    if (this.scene) {
      this.scene.emitter.emit('move_to_entity', entityName);
    }
  }

  public select(entityName: string): void {
    if (this.scene) {
      this.scene.emitter.emit('select_entity', entityName);
    }
  }

  /**
   * Publishes a message to an advertised topic.
   */
  public publish(): void {
    if (this.scene && this.publisher) {
      let msg = this.publisher.createMessage(this.msgData);
      this.publisher.publish(msg);
    }
  }

  /**
   * Get the list of models in the scene
   * @return The list of available models.
   */
  public getModels(): any[] {
    return this.models;
  }

  /**
   * Disconnect from the Gazebo server
   */
  public disconnect(): void {
    // Remove the canvas. Helpful to disconnect and connect several times.
    if (this.sceneElement?.childElementCount > 0 && this.scene.scene.renderer?.domElement) {
      this.sceneElement.removeChild(this.scene.scene.renderer.domElement);
    }

    this.transport.disconnect();
    this.sceneInfo = {};
    this.connectionStatus = 'disconnected';

    // Unsubscribe from observables.
    if (this.sceneInfoSubscription) {
      this.sceneInfoSubscription.unsubscribe();
    }
    if (this.particleEmittersSubscription) {
      this.particleEmittersSubscription.unsubscribe();
    }

    if (this.statusSubscription) {
      this.statusSubscription.unsubscribe();
    }
  }

  /**
   * Connect to a Gazebo server
   * @param url A websocket url that points to a Gazebo server.
   * @param key An optional authentication key.
   */
  public connect(url: string, key?: string): void {
    this.transport.connect(url, key);

    this.statusSubscription = this.transport.getConnectionStatus().subscribe((response) => {
      if (response === 'error') {
        // TODO: Return an error so the caller can open a snackbar
        console.log('Connection failed. Please contact an administrator.');
        // this.snackBar.open('Connection failed. Please contact an administrator.', 'Got it');
      }

      this.connectionStatus = response;

      // We can start setting up the visualization after we are Connected.
      // We still don't have scene and world information at this step.
      if (response === 'connected') {
        this.setupVisualization();
      }

      // Once the status is ready, we have the world and scene information
      // available.
      if (response === 'ready') {
        this.subscribeToTopics();
        if (this.topicName) {
          this.publisher = this.advertise(this.topicName, this.msgType);
          console.log(`Advertised ${this.topicName} with msg type of
                      ${this.msgType}`);
        }
      }
    });

    // Scene information.
    this.sceneInfoSubscription = this.transport.sceneInfo$.subscribe((sceneInfo) => {
      if (!sceneInfo) {
        return;
      }

      if ('sky' in sceneInfo && sceneInfo['sky']) {
        const sky = sceneInfo['sky'];

        // Check to see if a cubemap has been specified in the header.
        if ('header' in sky && sky['header'] && sky['header']['data']) {
          const data = sky['header']['data'];
          for (let i = 0; i < data.length; ++i) {
            if (data[i]['key'] === 'cubemap_uri' &&
                data[i]['value'] !== undefined) {
              this.scene.addSky(data[i]['value'][0]);
            }
          }
        } else {
          this.scene.addSky();
        }
      }
      this.sceneInfo = sceneInfo;
      this.startVisualization();

      sceneInfo['model'].forEach((model: any) => {
        const modelObj = this.sdfParser.spawnFromObj(
          { model }, { enableLights: false });

        model['gz3dName'] = modelObj.name;
        this.models.push(model);
        this.scene.add(modelObj);
      });

      sceneInfo['light'].forEach((light: any) => {
        const lightObj = this.sdfParser.spawnLight(light);
        this.scene.add(lightObj);
      });

      // Set the ambient color, if present
      if (sceneInfo['ambient'] !== undefined &&
          sceneInfo['ambient'] !== null) {
        this.scene.ambient.color = new THREE.Color(
          sceneInfo['ambient']['r'],
          sceneInfo['ambient']['g'],
          sceneInfo['ambient']['b']);
      }
    });
  }

  /**
   * Advertise a topic.
   *
   * @param topic The topic to advertise.
   */
  public advertise(topic: string, msgTypeName: string): Publisher {
    return this.transport.advertise(topic, msgTypeName);
  }

  /**
   * Allows clients to subscribe to a custom topic.
   *
   * @param topic The topic to subscribe to.
   */
  public subscribeToTopic(topic: Topic): void {
    this.transport.subscribe(topic);
  }

  /**
   * Allows clients to unsubscribe from topics.
   *
   * @param name The name of the topic to unsubscribe from.
   */
  public unsubscribeFromTopic(name: string): void {
    this.transport.unsubscribe(name);
  }

  /**
   * Play the Simulation.
   */
  public play(): void {
    this.transport.requestService(
      `/world/${this.transport.getWorld()}/control`,
      'ignition.msgs.WorldControl',
      {pause: false}
    );
  }

  /**
   * Pause the Simulation.
   */
  public pause(): void {
    this.transport.requestService(
      `/world/${this.transport.getWorld()}/control`,
      'ignition.msgs.WorldControl',
      {pause: true}
    );
  }

  /**
   * Stop the Simulation.
   */
  public stop(): void {
    this.transport.requestService(
      '/server_control',
      'ignition.msgs.ServerControl',
      {stop: true}
    );
  }

  /**
   * Subscribe to Gazebo topics required to render a scene.
   *
   * This includes:
   * - /world/WORLD_NAME/dynamic_pose/info
   * - /world/WORLD_NAME/scene/info
   */
  private subscribeToTopics(): void {
    // Subscribe to the pose topic and modify the models' poses.
    const poseTopic = new Topic(
      `/world/${this.transport.getWorld()}/dynamic_pose/info`,
      (msg) => {
        msg['pose'].forEach((pose: any) => {
          let entityName = pose['name'];
          // Objects created by Gz3D have an unique name, which is the
          // name plus the id.
          const entity = this.scene.getByName(entityName);

          if (entity) {
            this.scene.setPose(entity, pose.position, pose.orientation);
          } else {
            console.warn('Unable to find entity with name ', entityName, entity);
          }
        });
      }
    );
    this.transport.subscribe(poseTopic);

    // Subscribe to the audio control topic.
    if (this.audioTopic) {
      const audioTopic = new AudioTopic(this.audioTopic, this.transport);
    }

    // Subscribe to the 'scene/info' topic which sends scene changes.
    const sceneTopic = new Topic(
      `/world/${this.transport.getWorld()}/scene/info`,
      (sceneInfo) => {
        if (!sceneInfo) {
          return;
        }

        // Process each model in the scene.
        sceneInfo['model'].forEach((model: any) => {

          // Check to see if the model already exists in the scene. This
          // could happen when a simulation level is loaded multiple times.
          let foundIndex = this.getModelIndex(model['name']);

          // If the model was not found, then add the new model. Otherwise
          // update the models ID.
          if (foundIndex < 0) {
            const modelObj = this.sdfParser.spawnFromObj(
              { model }, { enableLights: false });
            this.models.push(model);
            this.scene.add(modelObj);
          } else {
            // Make sure to update the exisiting models so that future pose
            // messages can update the model.
            this.models[foundIndex]['id'] = model['id'];
          }
        });
      }
    );
    this.transport.subscribe(sceneTopic);
  }

  /**
   * Get the index into the model array of a model based on a name
   */
  private getModelIndex(name: string): number {
    let foundIndex = -1;
    for (let i = 0; i < this.models.length; ++i) {
      // Simulation enforces unique names between models. The ID
      // of a model may change. This occurs when levels are loaded,
      // unloaded, and then reloaded.
      if (this.models[i]['name'] === name) {
          foundIndex = i;
          break;
      }
    }
    return foundIndex;
  }

  /**
   * Setup the visualization scene.
   */
  private setupVisualization(): void {
    var that = this;

    // Create a find asset helper
    function findAsset(_uri: string, _cb: any) {
      that.transport.getAsset(_uri, _cb);
    }

    this.scene = new Scene({
      shaders: new Shaders(),
      findResourceCb: findAsset,
    });
    this.sdfParser = new SDFParser(this.scene);
    this.sdfParser.usingFilesUrls = true;

    if (window.document.getElementById(this.elementId)) {
      this.sceneElement = window.document.getElementById(this.elementId)!;
    } else {
      console.error('Unable to find HTML element with an id of',
                    this.elementId);
    }
    this.sceneElement.appendChild(this.scene.renderer.domElement);

    this.scene.setSize(this.sceneElement.clientWidth, this.sceneElement.clientHeight);
  }

  /**
   * Animation loop.
   *
   * Renders the scene and updates any system and time-related variables.
   */
  private animate(): void {
    this.cancelAnimation = requestAnimationFrame((timestampMs) => {
      if (this.previousRenderTimestampMs === 0) {
        this.previousRenderTimestampMs = timestampMs;
      }

      this.animate();

      if (this.scene.getParticleSystem()) {
        this.scene.getParticleSystem().update();
      }

      this.scene.render(timestampMs - this.previousRenderTimestampMs);
      this.previousRenderTimestampMs = timestampMs;
    });
  }

  /**
   * Start the visualization rendering loop.
   */
  private startVisualization(): void {
    this.animate();
  }
}
