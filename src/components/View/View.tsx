import React, { Component, CSSProperties, HTMLAttributes, ReactNode, ReactElement } from 'react';
import { classNames } from '../../lib/classNames';
import { transitionEvent, animationEvent } from '../../lib/supportEvents';
import { getClassName } from '../../helpers/getClassName';
import { IOS, ANDROID, VKCOM } from '../../lib/platform';
import Touch, { TouchEvent } from '../Touch/Touch';
import { removeObjectKeys } from '../../lib/removeObjectKeys';
import { HasPlatform } from '../../types';
import { withPlatform } from '../../hoc/withPlatform';
import { withContext } from '../../hoc/withContext';
import { ConfigProviderContext, ConfigProviderContextInterface } from '../ConfigProvider/ConfigProviderContext';
import { createCustomEvent } from '../../lib/utils';
import { SplitColContext, SplitColContextProps } from '../SplitCol/SplitCol';
import { AppRootPortal } from '../AppRoot/AppRootPortal';
import { canUseDOM, withDOM, DOMProps } from '../../lib/dom';
import { ScrollContext, ScrollContextInterface } from '../AppRoot/ScrollContext';

export const transitionStartEventName = 'VKUI:View:transition-start';
export const transitionEndEventName = 'VKUI:View:transition-end';

enum SwipeBackResults { fail = 1, success}

interface Scrolls {
  [index: string]: number;
}

export type TransitionStartEventDetail = {
  scrolls: Scrolls;
  from: string;
  to: string;
  isBack: boolean;
};

interface ViewsScrolls {
  [index: string]: Scrolls;
}

type AnimationEventHandler = (e?: AnimationEvent) => void;

type TransitionEventHandler = (e?: TransitionEvent) => void;

let scrollsCache: ViewsScrolls = {};

const swipeBackExcludedTags = ['input', 'textarea'];

export interface ViewProps extends HTMLAttributes<HTMLElement>, HasPlatform {
  activePanel: string;
  popout?: ReactNode;
  modal?: ReactNode;
  onTransition?(params: { isBack: boolean; from: string; to: string }): void;
  /**
   * callback свайпа назад
   */
  onSwipeBack?(): void;
  /**
   * callback начала анимации свайпа назад.
   */
  onSwipeBackStart?(): void;
  /**
   * callback завершения анимации отмененного пользователем свайпа
   */
  onSwipeBackCancel?(): void;
  history?: string[];
  id?: string;
  /**
   * @ignore
   */
  splitCol?: SplitColContextProps;
  /**
   * @ignore
   */
  configProvider?: ConfigProviderContextInterface;
  /**
   * @ignore
   */
  scroll?: ScrollContextInterface;
}

export interface ViewState {
  scrolls: Scrolls;
  animated: boolean;
  startT?: Date;

  visiblePanels: string[];
  activePanel: string;
  isBack: boolean;
  prevPanel: string;
  nextPanel: string;

  swipingBack: boolean;
  swipebackStartX: number;
  swipeBackShift: number;
  swipeBackNextPanel: string;
  swipeBackPrevPanel: string;
  swipeBackResult: SwipeBackResults;

  browserSwipe: boolean;
}

class View extends Component<ViewProps & DOMProps, ViewState> {
  constructor(props: ViewProps) {
    super(props);

    this.state = {
      scrolls: scrollsCache[props.id] || {},
      animated: false,

      visiblePanels: [props.activePanel],
      activePanel: props.activePanel,
      isBack: undefined,
      prevPanel: null,
      nextPanel: null,

      swipingBack: false,
      swipebackStartX: 0,
      swipeBackShift: 0,
      swipeBackNextPanel: null,
      swipeBackPrevPanel: null,
      swipeBackResult: null,

      browserSwipe: false,
    };
  }

  static defaultProps: Partial<ViewProps> = {
    history: [],
  };

  private transitionFinishTimeout: ReturnType<typeof setTimeout>;
  private animationFinishTimeout: ReturnType<typeof setTimeout>;

  get document() {
    return this.props.document;
  }

  get window() {
    return this.props.window;
  }

  get panels() {
    return React.Children.toArray(this.props.children) as ReactElement[];
  }

  panelNodes: { [id: string]: HTMLDivElement } = {};

  componentWillUnmount() {
    if (this.props.id) {
      scrollsCache[this.props.id] = this.state.scrolls;
    }
  }

  componentDidUpdate(prevProps: ViewProps, prevState: ViewState) {
    this.props.popout && !prevProps.popout && this.blurActiveElement();
    this.props.modal && !prevProps.modal && this.blurActiveElement();

    // Нужен переход
    if (prevProps.activePanel !== this.props.activePanel && !prevState.swipingBack && !prevState.browserSwipe) {
      const firstLayer = this.panels.find(
        (panel) => panel.props.id === prevProps.activePanel || panel.props.id === this.props.activePanel,
      );

      const isBack = firstLayer && firstLayer.props.id === this.props.activePanel;

      this.blurActiveElement();

      this.setState({
        visiblePanels: [prevProps.activePanel, this.props.activePanel],
        prevPanel: prevProps.activePanel,
        nextPanel: this.props.activePanel,
        activePanel: null,
        animated: true,
        scrolls: {
          ...prevState.scrolls,
          [prevProps.activePanel]: this.props.scroll.getScroll().y,
        },
        isBack,
      });
    }

    // Закончилась анимация свайпа назад
    if (prevProps.activePanel !== this.props.activePanel && prevState.swipingBack) {
      const nextPanel = this.props.activePanel;
      const prevPanel = prevProps.activePanel;
      this.setState({
        swipeBackPrevPanel: null,
        swipeBackNextPanel: null,
        swipingBack: false,
        swipeBackResult: null,
        swipebackStartX: 0,
        swipeBackShift: 0,
        activePanel: nextPanel,
        visiblePanels: [nextPanel],
        scrolls: removeObjectKeys(prevState.scrolls, [prevState.swipeBackPrevPanel]),
      }, () => {
        this.document.dispatchEvent(createCustomEvent(this.window, transitionEndEventName));
        this.props.scroll.scrollTo(0, prevState.scrolls[this.state.activePanel]);
        prevProps.onTransition && prevProps.onTransition({ isBack: true, from: prevPanel, to: nextPanel });
      });
    }

    const scrolls = this.state.scrolls;

    // Начался переход
    if (!prevState.animated && this.state.animated) {
      const transitionStartEventData = {
        detail: {
          from: this.state.prevPanel,
          to: this.state.nextPanel,
          isBack: this.state.isBack,
          scrolls,
        },
      };
      this.document.dispatchEvent(new (this.window as any).CustomEvent(transitionStartEventName, transitionStartEventData));
      const nextPanelElement = this.pickPanel(this.state.nextPanel);
      const prevPanelElement = this.pickPanel(this.state.prevPanel);

      prevPanelElement.scrollTop = scrolls[this.state.prevPanel];
      if (this.state.isBack) {
        nextPanelElement.scrollTop = scrolls[this.state.nextPanel];
      }
      this.waitAnimationFinish(this.pickPanel(this.state.isBack ? this.state.prevPanel : this.state.nextPanel), this.transitionEndHandler);
    }

    // Начался свайп назад
    if (!prevState.swipingBack && this.state.swipingBack) {
      const transitionStartEventData = {
        detail: {
          from: this.state.swipeBackPrevPanel,
          to: this.state.swipeBackNextPanel,
          scrolls,
        },
      };
      this.document.dispatchEvent(new (this.window as any).CustomEvent(transitionStartEventName, transitionStartEventData));
      this.props.onSwipeBackStart && this.props.onSwipeBackStart();
      const nextPanelElement = this.pickPanel(this.state.swipeBackNextPanel);
      const prevPanelElement = this.pickPanel(this.state.swipeBackPrevPanel);

      nextPanelElement.scrollTop = scrolls[this.state.swipeBackNextPanel];
      prevPanelElement.scrollTop = scrolls[this.state.swipeBackPrevPanel];
    }

    // Началась анимация завершения свайпа назад.
    if (!prevState.swipeBackResult && this.state.swipeBackResult) {
      this.waitTransitionFinish(this.pickPanel(this.state.swipeBackNextPanel), this.swipingBackTransitionEndHandler);
    }

    // Если свайп назад отменился (когда пользователь недостаточно сильно свайпнул)
    if (prevState.swipeBackResult === SwipeBackResults.fail && !this.state.swipeBackResult) {
      this.props.scroll.scrollTo(0, scrolls[this.state.activePanel]);
    }

    // Закончился Safari свайп
    if (prevProps.activePanel !== this.props.activePanel && this.state.browserSwipe) {
      this.setState({
        browserSwipe: false,
        nextPanel: null,
        prevPanel: null,
        animated: false,
        visiblePanels: [this.props.activePanel],
        activePanel: this.props.activePanel,
      });
    }
  }

  shouldDisableTransitionMotion(): boolean {
    return this.props.configProvider.transitionMotionEnabled === false ||
      !this.props.splitCol.animate;
  }

  waitTransitionFinish(elem: HTMLElement, eventHandler: TransitionEventHandler): void {
    if (transitionEvent.supported) {
      elem.removeEventListener(transitionEvent.name, eventHandler);
      elem.addEventListener(transitionEvent.name, eventHandler);
    } else {
      clearTimeout(this.transitionFinishTimeout);
      this.transitionFinishTimeout = setTimeout(eventHandler, this.props.platform === ANDROID || this.props.platform === VKCOM ? 300 : 600);
    }
  }

  waitAnimationFinish(elem: HTMLElement, eventHandler: AnimationEventHandler): void {
    if (this.shouldDisableTransitionMotion()) {
      eventHandler();
      return;
    }

    if (animationEvent.supported) {
      elem.removeEventListener(animationEvent.name, eventHandler);
      elem.addEventListener(animationEvent.name, eventHandler);
    } else {
      clearTimeout(this.animationFinishTimeout);
      this.animationFinishTimeout = setTimeout(eventHandler, this.props.platform === ANDROID || this.props.platform === VKCOM ? 300 : 600);
    }
  }

  blurActiveElement(): void {
    if (typeof this.window !== 'undefined' && this.document.activeElement) {
      (this.document.activeElement as HTMLElement).blur();
    }
  }

  pickPanel(id: string) {
    return this.panelNodes[id];
  }

  transitionEndHandler = (e?: AnimationEvent): void => {
    if (!e || [
      'vkui-animation-ios-next-forward',
      'vkui-animation-ios-prev-back',
      'vkui-animation-view-next-forward',
      'vkui-animation-view-prev-back',
    ].includes(e.animationName)) {
      const activePanel = this.props.activePanel;
      const isBack = this.state.isBack;
      const prevPanel = this.state.prevPanel;
      this.document.dispatchEvent(createCustomEvent(this.window, transitionEndEventName));
      this.setState({
        prevPanel: null,
        nextPanel: null,
        visiblePanels: [activePanel],
        activePanel: activePanel,
        animated: false,
        isBack: undefined,
        scrolls: isBack ? removeObjectKeys(this.state.scrolls, [prevPanel]) : this.state.scrolls,
      }, () => {
        isBack && this.props.scroll.scrollTo(0, this.state.scrolls[activePanel]);
        this.props.onTransition && this.props.onTransition({ isBack, from: prevPanel, to: activePanel });
      });
    }
  };

  swipingBackTransitionEndHandler = (e?: TransitionEvent): void => {
    // indexOf because of vendor prefixes in old browsers
    const target = e.target as HTMLElement;
    if (e.propertyName.includes('transform') && target === this.pickPanel(this.state.swipeBackNextPanel)) {
      switch (this.state.swipeBackResult) {
        case SwipeBackResults.fail:
          this.onSwipeBackCancel();
          break;
        case SwipeBackResults.success:
          this.onSwipeBackSuccess();
      }
    }
  };

  onSwipeBackSuccess(): void {
    this.props.onSwipeBack && this.props.onSwipeBack();
  }

  onSwipeBackCancel(): void {
    this.props.onSwipeBackCancel && this.props.onSwipeBackCancel();
    this.setState({
      swipeBackPrevPanel: null,
      swipeBackNextPanel: null,
      swipingBack: false,
      swipeBackResult: null,
      swipebackStartX: 0,
      swipeBackShift: 0,
    }, () => {
      this.document.dispatchEvent(createCustomEvent(this.window, transitionEndEventName));
    });
  }

  onMoveX = (e: TouchEvent): void => {
    const target = e.originalEvent.target as HTMLElement;
    if (
      target &&
      typeof target.tagName === 'string' &&
      swipeBackExcludedTags.includes(target.tagName.toLowerCase())
    ) {
      return;
    }

    const { platform, configProvider } = this.props;

    if (platform === IOS && !configProvider.isWebView && (e.startX <= 70 || e.startX >= this.window.innerWidth - 70) && !this.state.browserSwipe) {
      this.setState({ browserSwipe: true });
    }

    if (platform === IOS && configProvider.isWebView && this.props.onSwipeBack) {
      if (this.state.animated && e.startX <= 70) {
        return;
      }

      if (e.startX <= 70 && !this.state.swipingBack && this.props.history.length > 1) {
        this.setState({
          swipingBack: true,
          swipebackStartX: e.startX,
          startT: e.startT,
          swipeBackPrevPanel: this.state.activePanel,
          swipeBackNextPanel: this.props.history.slice(-2)[0],
          scrolls: {
            ...this.state.scrolls,
            [this.state.activePanel]: this.props.scroll.getScroll().y,
          },
        });
      }
      if (this.state.swipingBack) {
        let swipeBackShift;
        if (e.shiftX < 0) {
          swipeBackShift = 0;
        } else if (e.shiftX > this.window.innerWidth - this.state.swipebackStartX) {
          swipeBackShift = this.window.innerWidth;
        } else {
          swipeBackShift = e.shiftX;
        }
        this.setState({ swipeBackShift });
      }
    }
  };

  onEnd = (): void => {
    if (this.state.swipingBack) {
      const speed = this.state.swipeBackShift / (Date.now() - this.state.startT.getTime()) * 1000;
      if (this.state.swipeBackShift === 0) {
        this.onSwipeBackCancel();
      } else if (this.state.swipeBackShift >= this.window.innerWidth) {
        this.onSwipeBackSuccess();
      } else if (speed > 250 || this.state.swipebackStartX + this.state.swipeBackShift > this.window.innerWidth / 2) {
        this.setState({ swipeBackResult: SwipeBackResults.success });
      } else {
        this.setState({ swipeBackResult: SwipeBackResults.fail });
      }
    }
  };

  calcPanelSwipeStyles(panelId: string): CSSProperties {
    if (!canUseDOM) {
      return {};
    }

    const isPrev = panelId === this.state.swipeBackPrevPanel;
    const isNext = panelId === this.state.swipeBackNextPanel;

    if (!isPrev && !isNext || this.state.swipeBackResult) {
      return {};
    }

    let prevPanelTranslate = `${this.state.swipeBackShift}px`;
    let nextPanelTranslate = `${-50 + this.state.swipeBackShift * 100 / this.window.innerWidth / 2}%`;
    let prevPanelShadow = 0.3 * (this.window.innerWidth - this.state.swipeBackShift) / this.window.innerWidth;

    if (this.state.swipeBackResult) {
      return isPrev ? { boxShadow: `-2px 0 12px rgba(0, 0, 0, ${prevPanelShadow})` } : {};
    }

    if (isNext) {
      return {
        transform: `translate3d(${nextPanelTranslate}, 0, 0)`,
        WebkitTransform: `translate3d(${nextPanelTranslate}, 0, 0)`,
      };
    }
    if (isPrev) {
      return {
        transform: `translate3d(${prevPanelTranslate}, 0, 0)`,
        WebkitTransform: `translate3d(${prevPanelTranslate}, 0, 0)`,
        boxShadow: `-2px 0 12px rgba(0, 0, 0, ${prevPanelShadow})`,
      };
    }

    return {};
  }

  render() {
    const {
      popout, modal, platform,
      activePanel: _1, splitCol, configProvider, history, id,
      onTransition, onSwipeBack, onSwipeBackStart, onSwipeBackCancel,
      window, document, scroll,
      ...restProps
    } = this.props;
    const { prevPanel, nextPanel, activePanel, swipeBackPrevPanel, swipeBackNextPanel, swipeBackResult } = this.state;

    const hasPopout = !!popout;
    const hasModal = !!modal;

    const panels = this.panels.filter((panel: React.ReactElement) => {
      const panelId = panel.props.id;

      return this.state.visiblePanels.includes(panelId) ||
        panelId === swipeBackPrevPanel ||
        panelId === swipeBackNextPanel;
    });

    const disableAnimation = this.shouldDisableTransitionMotion();

    const modifiers = {
      'View--animated': !disableAnimation && this.state.animated,
      'View--swiping-back': !disableAnimation && this.state.swipingBack,
      'View--no-motion': disableAnimation,
    };

    return (
      <Touch
        Component="section"
        {...restProps}
        vkuiClass={classNames(getClassName('View', platform), modifiers)}
        onMoveX={this.onMoveX}
        onEnd={this.onEnd}
      >
        <div vkuiClass="View__panels">
          {panels.map((panel: React.ReactElement) => {
            const panelId = panel.props.id;

            return (
              <div
                vkuiClass={classNames('View__panel', {
                  'View__panel--active': panelId === activePanel,
                  'View__panel--prev': panelId === prevPanel,
                  'View__panel--next': panelId === nextPanel,
                  'View__panel--swipe-back-prev': panelId === swipeBackPrevPanel,
                  'View__panel--swipe-back-next': panelId === swipeBackNextPanel,
                  'View__panel--swipe-back-success': swipeBackResult === SwipeBackResults.success,
                  'View__panel--swipe-back-failed': swipeBackResult === SwipeBackResults.fail,
                })}
                ref={(el) => this.panelNodes[panelId] = el}
                data-vkui-active-panel={panelId === activePanel ? 'true' : ''}
                style={this.calcPanelSwipeStyles(panelId)}
                key={panelId}
              >
                <div vkuiClass="View__panel-in">
                  {panel}
                </div>
              </div>
            );
          })}
        </div>
        <AppRootPortal>
          {hasPopout && <div vkuiClass="View__popout">{popout}</div>}
          {hasModal && <div vkuiClass="View__modal">{modal}</div>}
        </AppRootPortal>
      </Touch>
    );
  }
}

export default withContext(withContext(
  withContext(
    withPlatform(withDOM<ViewProps>(View)),
    SplitColContext, 'splitCol'),
  ConfigProviderContext, 'configProvider'),
ScrollContext, 'scroll');
