FROM ubuntu:24.10

ARG USERNAME=ubuntu
ARG HOME=/home/${USERNAME}
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Set locale before any packages are installed,
# since packages are influenced by the current locale on installation
#
# This is necessary for some terminal tools to work well
#  See: https://github.com/ohmyzsh/ohmyzsh/wiki/FAQ#i-see-duplicate-typed-characters-after-i-complete-a-command
RUN apt-get update && apt-get install -y language-pack-en
RUN echo LC_CTYPE=\"en_US.UTF-8\" "\n" \
    LC_ALL=\"en_US.UTF-8\" "\n" \
    LANG=\"en_US.UTF-8\" "\n" > /etc/default/locale


# Get build packages
RUN apt-get update && apt-get install -y \
    build-essential \
    curl git fish \
    vim sudo \
    cmake `#for compiling llama-cpp, if we need to`

# Install the cuda toolkit
RUN curl -L https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb > ${HOME}/cuda-keyring_1.1-1_all.deb
RUN dpkg -i ${HOME}/cuda-keyring_1.1-1_all.deb
RUN apt-get update
RUN apt-get -y install cuda-toolkit-12-8

# Get Node
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - 
RUN apt-get update && apt-get install -y nodejs

# Preload yarn with corepack
RUN corepack enable
RUN corepack prepare yarn@4.6.0 --activate

# Create the user (disabled: user is default 'ubuntu')
# RUN groupadd --gid $USER_GID $USERNAME \
#     && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME

# [Optional] Add sudo support. Omit if you don't need to install software after connecting.
RUN echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Set up persistent cache directories
RUN mkdir -p \
    /cache/xdg-home
RUN chown -R ${USERNAME}:${USERNAME} /cache

# Start acting as the container user to avoid permissions issues
USER ${USERNAME}

# Set up mergiraf for syntax-aware merging
RUN mkdir -p ${HOME}/bin
RUN curl -v https://codeberg.org/mergiraf/mergiraf/releases/download/v0.2.0/mergiraf_x86_64-unknown-linux-gnu.tar.gz > ${HOME}/mergiraf.tar.gz
RUN tar -xvf ${HOME}/mergiraf.tar.gz -C ${HOME}/bin
RUN rm ${HOME}/mergiraf.tar.gz

# Set up difftastic for syntax-aware diffs
RUN curl -L https://github.com/Wilfred/difftastic/releases/download/0.63.0/difft-x86_64-unknown-linux-gnu.tar.gz > ${HOME}/difft-aarch64-unknown-linux-gnu.tar.gz
RUN tar -xvf ${HOME}/difft-aarch64-unknown-linux-gnu.tar.gz -C ${HOME}/bin

# Configure mergiraf and difftastic
COPY .gitattributes ${HOME}/.gitattributes
COPY .gitconfig ${HOME}/.gitconfig

# Reconfigure xdg_home into a shared volume so fish will persist
# terminal history through rebuilds
ENV XDG_DATA_HOME="/cache/xdg-home"

# Setup fisher (a fish plugin manager)
RUN fish -c 'curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/1f0dc2b4970da160605638cb0f157079660d6e04/functions/fisher.fish | source && fisher install jorgebucaran/fisher'
# Install a theme I like with the plugin manager
RUN fish -c 'fisher install IlanCosman/tide@v5'
# Install a fenv for syncing state with other shells
RUN fish -c 'fisher install IlanCosman/tide@v5'
# Configure fish
COPY config.fish ${HOME}/fish/config.fish
# Configure the theme
RUN fish -c 'echo "121121y" | tide configure'

# This should happen earlier in the container but I'm on train wifi
# and don't want to force a rebuild
RUN sudo apt-get update && sudo apt-get install -y \
    strace
