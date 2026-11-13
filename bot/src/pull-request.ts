import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, sep } from "node:path";
import { dashboardLink } from "./config.js";
import type { Purchase } from "./x402.js";
import type { PreparedUpdate } from "./updates.js";
import { readRepositoryFile, updateManifest } from "./updates.js";

type GitReference = { ref: string; object: { sha: string } };
type GitCommit = { tree: { sha: string }; parents: { sha: string }[] };

export type PurchaseEvidence = Pick<
  Purchase,
  "minerId" | "intent" | "receiptHash" | "signalHash" | "txHash" | "amountUsdc"
>;

export const checkedOutBranch = (root: string): string => {
  try {
    return execFileSync(
      "git",
      ["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    throw new Error(
      "Check out a named branch before running the action; detached HEAD checkouts have no PR target branch",
    );
  }
};

export const assertPublicRepository = async (
  repository: string,
  token: string,
): Promise<void> => {
  const response = await fetch(`https://api.github.com/repos/${repository}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Repository visibility check failed: HTTP ${response.status}`,
    );
  const repositoryInfo = (await response.json()) as { private?: boolean };
  if (repositoryInfo.private !== false)
    throw new Error(
      "Automatic dependency PRs support public repositories only",
    );
};

export const createDependencyPr = async (options: {
  root: string;
  repository: string;
  baseSha: string;
  baseBranch: string;
  token: string;
  update: PreparedUpdate;
  purchase: PurchaseEvidence;
  /** Open the PR as a draft; ready for review when absent or false. */
  draft?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<string> => {
  const { root, repository, baseSha, baseBranch, token, update, purchase } =
    options;
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    !/^[a-f0-9]{40}$/.test(baseSha)
  ) {
    throw new Error("Invalid repository or base commit");
  }
  execFileSync("git", ["check-ref-format", `refs/heads/${baseBranch}`], {
    stdio: "pipe",
  });
  const { finding, files } = update;
  const expected = updateManifest(
    readRepositoryFile(root, finding.source),
    finding,
  );
  const manifest = files.find((file) => file.path === finding.source);
  if (
    !manifest ||
    manifest.content !== expected ||
    new Set(files.map((file) => file.path)).size !== files.length
  ) {
    throw new Error(
      "Prepared manifest does not match the validated dependency update",
    );
  }
  const lockPath = join(dirname(finding.source), "package-lock.json")
    .split(sep)
    .join("/");
  const allowed =
    finding.ecosystem === "npm" ? [finding.source, lockPath] : [finding.source];
  if (
    files.length !== allowed.length ||
    files.some((file) => !allowed.includes(file.path))
  ) {
    throw new Error("Prepared changes contain unexpected or missing files");
  }
  if (finding.ecosystem === "npm") {
    const lock = JSON.parse(
      files.find((file) => file.path === lockPath)!.content,
    );
    if (
      ![2, 3].includes(lock.lockfileVersion) ||
      lock.packages?.[`node_modules/${finding.package}`]?.version !==
        finding.targetVersion
    ) {
      throw new Error(
        "Prepared lockfile does not resolve the recommended version",
      );
    }
    const expectedManifest = JSON.parse(expected);
    for (const section of ["dependencies", "devDependencies"]) {
      if (
        JSON.stringify(
          Object.entries(lock.packages?.[""]?.[section] ?? {}).sort(),
        ) !==
        JSON.stringify(Object.entries(expectedManifest[section] ?? {}).sort())
      ) {
        throw new Error(
          "Prepared lockfile declarations differ from the manifest",
        );
      }
    }
  }
  const request = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> => {
    const response = await (options.fetchImpl ?? fetch)(
      `https://api.github.com/repos/${repository}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      // GitHub explains a refusal in the body's `message`; fall back to the raw text.
      const text = await response.text();
      let reason = text;
      try {
        reason = String(JSON.parse(text).message ?? text);
      } catch {
        // Not JSON: keep the raw text as the reason.
      }
      if (method === "POST" && path === "/pulls" && response.status === 403) {
        throw new Error(
          "GitHub Actions is not allowed to create pull requests in this repository. Enable Settings → Actions → General → " +
            '"Allow GitHub Actions to create and approve pull requests", save, and re-run: paid answers are reused, ' +
            `nothing is bought again. (GitHub: ${reason.slice(0, 200)})`,
        );
      }
      throw new Error(
        `GitHub ${method} ${path}: HTTP ${response.status}${reason ? `: ${reason.slice(0, 200)}` : ""}`,
      );
    }
    return response.json() as Promise<T>;
  };
  const identity = createHash("sha256")
    .update(
      JSON.stringify([
        baseBranch,
        finding.ecosystem,
        finding.source,
        finding.package,
        finding.currentVersion,
        finding.targetVersion,
      ]),
    )
    .digest("hex")
    .slice(0, 24);
  const branch = `fix/telegraph-dependency-${identity}`;
  const owner = repository.split("/")[0];
  const existing = await request<{ html_url: string }[]>(
    `/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(baseBranch)}&per_page=100`,
  );
  if (!Array.isArray(existing))
    throw new Error("GitHub returned an invalid pull request list");
  if (existing.length) return existing[0].html_url;

  const repo = await request<{ private: boolean }>("");
  if (repo.private !== false)
    throw new Error(
      "Automatic dependency PRs support public repositories only",
    );
  const base = await request<GitReference>(
    `/git/ref/heads/${encodeURIComponent(baseBranch)}`,
  );
  if (base.object?.sha !== baseSha)
    throw new Error(
      "Checked-out branch changed or assessment did not run on its current commit; reassess before publishing",
    );
  const commit = await request<GitCommit>(`/git/commits/${baseSha}`);
  const tree = await request<{ sha: string }>("/git/trees", "POST", {
    base_tree: commit.tree.sha,
    tree: files.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      content: file.content,
    })),
  });
  const title = `deps: update ${finding.package} to ${finding.targetVersion}`;
  const updatedCommit = await request<{ sha: string }>("/git/commits", "POST", {
    message: title,
    tree: tree.sha,
    parents: [baseSha],
  });
  // A failed publication may leave a branch. Reuse it only if its tree and parent match exactly.
  const refs = await request<GitReference[]>(
    `/git/matching-refs/heads/${branch}`,
  );
  const branchRef = refs.find(
    (ref: { ref: string }) => ref.ref === `refs/heads/${branch}`,
  );
  if (branchRef) {
    const previous = await request<GitCommit>(
      `/git/commits/${branchRef.object.sha}`,
    );
    if (
      previous.tree.sha !== tree.sha ||
      previous.parents.length !== 1 ||
      previous.parents[0].sha !== baseSha
    ) {
      throw new Error(
        `Existing branch ${branch} differs; refusing to overwrite it`,
      );
    }
  } else {
    await request("/git/refs", "POST", {
      ref: `refs/heads/${branch}`,
      sha: updatedCommit.sha,
    });
  }
  const detail = {
    ecosystem: finding.ecosystem,
    package: finding.package,
    source: finding.source,
    currentVersion: finding.currentVersion,
    targetVersion: finding.targetVersion,
    issue: finding.issue,
    reason: finding.reason,
    cves: finding.cves,
    sources: finding.sources,
    purchase,
  };
  const body = `Updates ${finding.package} from ${finding.currentVersion} to ${finding.targetVersion}.\n\nMiner finding and purchase evidence:\n\n${JSON.stringify(
    detail,
    null,
    2,
  )
    .split("\n")
    .map((line) => `    ${line}`)
    .join(
      "\n",
    )}\n\nFor human review before merging. Registry version availability was checked. CVE claims and migration compatibility require independent review and repository CI. No repository tests were executed by the payment or publication jobs.\n\nSpend and receipts for this repository: ${dashboardLink(repository)}`;
  const pr = await request<{ html_url: string }>("/pulls", "POST", {
    title,
    head: branch,
    base: baseBranch,
    draft: options.draft ?? false,
    body,
  });
  return pr.html_url;
};
