import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SingleTileRippleAnimation } from '../SingleTileRippleAnimation';

describe('SingleTileRippleAnimation', () => {
  let mockScene: any;
  let mockContainer: any;
  let mockOriginRect: any;
  
  let addedTweens: any[] = [];
  let addedChildren: any[] = [];
  let addedGraphics: any[] = [];

  beforeEach(() => {
    addedTweens = [];
    addedChildren = [];
    addedGraphics = [];

    // Mock Phaser.Scene
    mockScene = {
      add: {
        graphics: vi.fn((config) => {
          const g = {
            ...config,
            clear: vi.fn(),
            fillStyle: vi.fn(),
            fillRect: vi.fn(),
            destroy: vi.fn(),
          };
          addedGraphics.push(g);
          return g;
        }),
      },
      tweens: {
        add: vi.fn((config) => {
          addedTweens.push(config);
          return config;
        })
      }
    };

    // Mock Phaser.GameObjects.Container
    mockContainer = {
      add: vi.fn((children) => {
        if (Array.isArray(children)) {
          addedChildren.push(...children);
        } else {
          addedChildren.push(children);
        }
      })
    };

    // Mock Phaser.GameObjects.Rectangle
    mockOriginRect = {
      x: 100,
      y: 200,
      setVisible: vi.fn(),
      setAlpha: vi.fn()
    };
  });

  it('should play the rectangular ripple animation gracefully', () => {
    const onCompleteMock = vi.fn();

    SingleTileRippleAnimation.play({
      scene: mockScene,
      container: mockContainer,
      originRect: mockOriginRect,
      width: 100,
      height: 200,
      color: 0x1a1a1a,
      duration: 180,
      onComplete: onCompleteMock
    });

    // 1. Should make original rectangle transparent immediately
    expect(mockOriginRect.setAlpha).toHaveBeenCalledWith(0.15);

    // 2. Should create 1 graphics object
    expect(mockScene.add.graphics).toHaveBeenCalledTimes(1);
    expect(addedGraphics.length).toBe(1);
    expect(mockContainer.add).toHaveBeenCalled(); // Contains graphics
    
    // 3. Should add a tween
    expect(mockScene.tweens.add).toHaveBeenCalledTimes(1);
    const tweenConfig = addedTweens[0];
    
    expect(tweenConfig.duration).toBe(180);
    expect(tweenConfig.targets.holeProgress).toBe(0.75);
    expect(tweenConfig.holeProgress).toBe(1.0);
    expect(typeof tweenConfig.onUpdate).toBe('function');
    expect(typeof tweenConfig.onComplete).toBe('function');

    // 4. Test intermediate geometry update via onUpdate manually
    tweenConfig.targets.holeProgress = 0.8;
    tweenConfig.onUpdate();

    const graphics = addedGraphics[0];
    
    expect(graphics.clear).toHaveBeenCalled();
    // The ripple stays completely solid black, no bleeding or fading
    expect(graphics.fillStyle).toHaveBeenLastCalledWith(0x1a1a1a, 1.0); 
    
    // Check if fillRect is called 4 times representing the 4 borders
    expect(graphics.fillRect).toHaveBeenCalledTimes(8); // 4 from init, 4 from update

    // 5. Test onComplete properly destroys
    tweenConfig.onComplete();

    // Should destroy temps
    addedGraphics.forEach(g => expect(g.destroy).toHaveBeenCalled());

    // Should invoke callback
    expect(onCompleteMock).toHaveBeenCalled();
  });
});
