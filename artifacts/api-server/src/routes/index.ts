import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import videosRouter from "./videos";
import storageRouter from "./storage";
import likesRouter from "./likes";
import followsRouter from "./follows";
import commentsRouter from "./comments";
import notificationsRouter from "./notifications";
import adminRouter from "./admin";
import conversationsRouter from "./conversations";
import friendsRouter from "./friends";
import storiesRouter from "./stories";
import highlightsRouter from "./highlights";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(videosRouter);
router.use(storageRouter);
router.use(likesRouter);
router.use(followsRouter);
router.use(commentsRouter);
router.use(notificationsRouter);
router.use(adminRouter);
router.use(conversationsRouter);
router.use(friendsRouter);
router.use(storiesRouter);
router.use(highlightsRouter);

export default router;
