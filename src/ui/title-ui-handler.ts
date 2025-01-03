import BattleScene from "../battle-scene";
import OptionSelectUiHandler from "./settings/option-select-ui-handler";
import { Mode } from "./ui";
import * as Utils from "../utils";
import { TextStyle, addTextObject, getTextStyleOptions } from "./text";
import { getSplashMessages, getAnnouncementMessage } from "../data/splash-messages";
import i18next from "i18next";
import { TimedEventDisplay } from "#app/timed-event-manager";
import { version } from "../../package.json";
import { pokerogueApi } from "#app/plugins/api/pokerogue-api";

export default class TitleUiHandler extends OptionSelectUiHandler {
  /** If the stats can not be retrieved, use this fallback value */
  private static readonly BATTLES_WON_FALLBACK: number = -99999999;
  private readonly ANNOUNCEMENT_CHANGE_INTERVAL = 10000; // 10秒切换一次

  private titleContainer: Phaser.GameObjects.Container;
  private playerCountLabel: Phaser.GameObjects.Text;
  private splashMessage: string;
  private splashMessageText: Phaser.GameObjects.Text;
  private eventDisplay: TimedEventDisplay;
  private appVersionText: Phaser.GameObjects.Text;

  // 添加公告相关属性
  private announcementContainer: Phaser.GameObjects.Container;
  private announcementText: Phaser.GameObjects.Text;

  private titleStatsTimer: NodeJS.Timeout | null;

  constructor(scene: BattleScene, mode: Mode = Mode.TITLE) {
    super(scene, mode);
  }

  setup() {
    super.setup();

    const ui = this.getUi();

    this.titleContainer = this.scene.add.container(0, -(this.scene.game.canvas.height / 6));
    this.titleContainer.setName("title");
    this.titleContainer.setAlpha(0);
    ui.add(this.titleContainer);

    const logo = this.scene.add.image((this.scene.game.canvas.width / 6) / 2, 8, "logo");
    logo.setOrigin(0.5, 0);
    this.titleContainer.add(logo);

    if (this.scene.eventManager.isEventActive()) {
      this.eventDisplay = new TimedEventDisplay(this.scene, 0, 0, this.scene.eventManager.activeEvent());
      this.eventDisplay.setup();
      this.titleContainer.add(this.eventDisplay);
    }

    this.playerCountLabel = addTextObject(
      this.scene,
      (this.scene.game.canvas.width / 6) - 2,
      (this.scene.game.canvas.height / 6) - 13 - 576 * getTextStyleOptions(TextStyle.WINDOW, this.scene.uiTheme).scale,
      `? ${i18next.t("menu:playersOnline")}`,
      TextStyle.MESSAGE,
      { fontSize: "54px" }
    );
    this.playerCountLabel.setOrigin(1, 0);
    this.titleContainer.add(this.playerCountLabel);

    this.splashMessageText = addTextObject(this.scene, logo.x + 64, logo.y + logo.displayHeight - 8, "", TextStyle.MONEY, { fontSize: "54px" });
    this.splashMessageText.setOrigin(0.5, 0.5);
    this.splashMessageText.setAngle(-20);
    this.titleContainer.add(this.splashMessageText);

    const originalSplashMessageScale = this.splashMessageText.scale;

    this.scene.tweens.add({
      targets: this.splashMessageText,
      duration: Utils.fixedInt(350),
      scale: originalSplashMessageScale * 1.25,
      loop: -1,
      yoyo: true,
    });

    this.appVersionText = addTextObject(this.scene, logo.x - 60, logo.y + logo.displayHeight + 4, "", TextStyle.MONEY, { fontSize: "54px" });
    this.appVersionText.setOrigin(0.5, 0.5);
    this.appVersionText.setAngle(0);
    this.titleContainer.add(this.appVersionText);

    // 创建公告容器，放在 logo 下方
    this.announcementContainer = this.scene.add.container(
      (this.scene.game.canvas.width / 6) / 2,
      logo.y + logo.displayHeight + 40  // 放在 logo 下方
    );
    this.announcementContainer.setName("announcement");

    // 创建公告文本
    this.announcementText = addTextObject(
      this.scene,
      0,
      0,
      getAnnouncementMessage(),
      TextStyle.WINDOW,
      {
        align: "center",
        wordWrap: { width: 160 },
        fontSize: "12px",
        resolution: 3,
        color: "#FFFFFF"
      }
    );
    this.announcementText.setOrigin(0.5, 0.5);
    this.announcementText.setScale(1);

    this.announcementContainer.add(this.announcementText);
    this.titleContainer.add(this.announcementContainer);

    // 设置定时器，定期更新公告
    this.scene.time.addEvent({
      delay: this.ANNOUNCEMENT_CHANGE_INTERVAL,
      callback: this.updateAnnouncement,
      callbackScope: this,
      loop: true
    });
  }

  private updateAnnouncement(): void {
    // 使用淡入淡出效果更新公告
    this.scene.tweens.add({
      targets: this.announcementText,
      alpha: 0,
      duration: 500,
      onComplete: () => {
        this.announcementText.setText(getAnnouncementMessage());
        this.scene.tweens.add({
          targets: this.announcementText,
          alpha: 1,
          duration: 500
        });
      }
    });
  }

  updateTitleStats(): void {
    pokerogueApi.getGameTitleStats()
      .then(stats => {
        if (stats) {
          this.playerCountLabel.setText(`${stats.playerCount} ${i18next.t("menu:playersOnline")}`);
          if (this.splashMessage === "splashMessages:battlesWon") {
            this.splashMessageText.setText(i18next.t(this.splashMessage, { count: stats.battleCount }));
          }
        }
      })
      .catch(err => {
        console.error("Failed to fetch title stats:\n", err);
      });
  }

  show(args: any[]): boolean {
    const ret = super.show(args);

    if (ret) {
      this.splashMessage = Utils.randItem(getSplashMessages());
      this.splashMessageText.setText(i18next.t(this.splashMessage, { count: TitleUiHandler.BATTLES_WON_FALLBACK }));

      this.appVersionText.setText("v" + version);

      const ui = this.getUi();

      if (this.scene.eventManager.isEventActive()) {
        this.eventDisplay.setWidth(this.scene.scaledCanvas.width - this.optionSelectBg.width - this.optionSelectBg.x);
        this.eventDisplay.show();
      }

      this.updateTitleStats();

      this.titleStatsTimer = setInterval(() => {
        this.updateTitleStats();
      }, 60000);

      this.scene.tweens.add({
        targets: [ this.titleContainer, ui.getMessageHandler().bg ],
        duration: Utils.fixedInt(325),
        alpha: (target: any) => target === this.titleContainer ? 1 : 0,
        ease: "Sine.easeInOut"
      });
    }

    return ret;
  }

  clear(): void {
    super.clear();

    const ui = this.getUi();

    this.eventDisplay?.clear();

    this.titleStatsTimer && clearInterval(this.titleStatsTimer);
    this.titleStatsTimer = null;

    this.scene.tweens.add({
      targets: [ this.titleContainer, ui.getMessageHandler().bg ],
      duration: Utils.fixedInt(325),
      alpha: (target: any) => target === this.titleContainer ? 0 : 1,
      ease: "Sine.easeInOut"
    });
  }
}
