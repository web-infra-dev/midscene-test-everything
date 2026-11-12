import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDebug } from '@midscene/shared/logger';

const log = getDebug('robot-arm:storage', { console: true });

export const STORAGE_README = `# Robot Arm local data

This folder is managed by \`@midscene/robot-arm\` (layout version 1). Do not edit it by hand.

| Entry | What it is |
| --- | --- |
| \`installations.json\` | Current selection and saved installations. \`.bak\` is the previous version. |
| \`installations/\` | One folder per physical installation, following its name (defaults to the robot model); renaming moves the folder too. |
| \`installations/<folder>/profiles.json\` | Measured tool, screen, calibration and camera binding. \`.bak\` is the previous version. |
| \`midscene_run/log/robot-arm/<installation-id>/actions.jsonl\` | Action audit outside this data root. \`.1\` is the rotated file. |
| \`storage.lock\` | Present while the service is running. Do not delete it then. |

Run logs default to the workspace root's \`midscene_run/log\` (the package directory outside a workspace); \`MIDSCENE_RUN_DIR\` overrides the run directory. Installation names do not change log paths. Existing managed audit files move there at startup. Each JSON keeps one previous version as \`.bak\`. For a full copy including audit files, run:

\`\`\`bash
pnpm --filter @midscene/robot-arm backup
\`\`\`

This folder is ignored by Git. \`git clean -fdx\`, reinstalling or switching worktrees can delete it.

---

# 机械臂本地数据

此目录由 \`@midscene/robot-arm\` 管理（布局版本 1），请勿手工编辑。

| 条目 | 说明 |
| --- | --- |
| \`installations.json\` | 当前选择与已保存安装；\`.bak\` 是上一版。 |
| \`installations/\` | 每个物理安装一个目录，跟随安装名称（默认使用机械臂型号），重命名时同步修改目录名。 |
| \`installations/<目录>/profiles.json\` | 实测工具、屏幕、标定和相机绑定；\`.bak\` 是上一版。 |
| \`midscene_run/log/robot-arm/<安装ID>/actions.jsonl\` | 数据根目录外的动作日志；\`.1\` 是轮转文件。 |
| \`storage.lock\` | 服务运行期间存在；运行期间不要删除。 |

运行日志默认位于工作区根目录的 \`midscene_run/log\`（非工作区使用包目录），\`MIDSCENE_RUN_DIR\` 可覆盖运行目录。重命名不改变日志路径；已有托管安装日志在启动时迁移。每个 JSON 只保留上一版 \`.bak\`。需要导出包含日志的完整副本时运行：

\`\`\`bash
pnpm --filter @midscene/robot-arm backup
\`\`\`

此目录被 Git 忽略；\`git clean -fdx\`、重装或切换 worktree 可能删除它。
`;

/** Write the folder map beside the data, without rewriting unchanged content. */
export async function writeStorageDocs(root: string): Promise<void> {
  try {
    const file = path.join(root, 'README.md');
    let current: string | undefined;
    try {
      current = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (current === STORAGE_README) return;
    await mkdir(root, { recursive: true });
    await writeFile(file, STORAGE_README, 'utf8');
  } catch (error) {
    log(
      `could not write the storage README: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
